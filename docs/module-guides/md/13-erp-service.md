# Service & Commissioning (Machines and Service Requests) Module

The Service & Commissioning module (code key "erp", shown in Settings as "Service") is where the company keeps a register of every machine it has built and supplied (called "Projects" in the menu, "Machines" in most messages) and handles all after-sales service on those machines through Service Requests (SRs). A machine record holds its identity (serial, model, engine and chassis numbers), the client and site it was delivered to, its operator, its technical details, its PO / dispatch / commissioning / handover dates, and its warranty and AMC cover. Service Requests are raised against a registered machine, move through a fixed 10-step workflow from Reported to Closed, capture root cause and corrective action, track spare parts (raised straight to Purchase as Purchase Requisitions), and record the cost and billing of the visit. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) this module covers the Dispatch date, Commissioning and Handover dates, the Machine register and the Service stage; it links back to Production (work orders and RRV builds that build the machine), to Sales orders, to Store (material issues and Item Master) and to Procurement (Purchase Requisitions for service parts). Billing values on an SR (service, transport, accommodation, material, tax, invoice number, payment status) are recorded here for hand-over to Finance; there is no automatic posting to Finance.

## 1. Navigation Tabs

The sub-nav (ErpNav) sits at the top of every page of the module. Each tab is shown only if the user has view access to that tab in the Permission Matrix (Service & Commissioning). On the right of the sub-nav are a guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/erp | The module dashboard ("Dashboard Panel") with counts, charts, the 8 latest service tickets and 8 machines. |
| Projects | /dashboard/erp/projects | The "Projects Asset Register" — the list of all machines, with filters, Import, Export and "+ Add New Project". |
| Service Requests | /dashboard/erp/service-requests | The "Service Request Registry" — the list of all SRs, with filters, Import, Export and "+ New Service Request". |
| Reports | /dashboard/erp/reports | Service KPIs and charts (status, priority, monthly trend, categories, cost). |
| Recycle Bin | /dashboard/erp/recycle-bin | Deleted machines and deleted service requests, with Restore buttons. |
| Settings | /dashboard/erp/settings | "Service settings" — approval switches and notification rules. |

## 2. Dashboard

Route: /dashboard/erp. Heading "Dashboard Panel" with the line "Welcome back, (user name). Here is the real-time operational state of your deployment assets."

The page loads up to 5,000 machines and up to 1,000 service requests (only those the user is allowed to see under their data scope). Machines and SRs load separately; if one fails a red banner "Some figures below are incomplete." names which list could not be loaded and why, while the other figures still show.

### Stat cards

Four cards in a row:

| Card | What it shows |
|---|---|
| Total Projects | Number of machines loaded (not deleted). |
| Total Service Requests | Number of SRs loaded. |
| Monthly SRs | SRs whose created date is in the current calendar month and year. |
| Total Active Tickets | SRs whose status is anything except Closed or Cancelled. |

**Actions:** none (display only).

### Project Deployment Status

A horizontal bar chart: one bar per machine status (Active, Under Service, Manufacturing Under Progress, Work In Progress, Standby, Inactive, Decommissioned, Cancel), length = number of machines in that status, sorted highest first. Each status has its own colour (for example Active green, Inactive red, Under Service yellow). Shows "No data yet." when there are no machines.

**Actions:** none.

### Active Tickets Breakdown

A donut chart of open SRs (status not Closed / Cancelled) split by priority: Urgent (red) and Standard (blue), with a legend showing the count of each. Shows "No open tickets." when there are none.

**Actions:** none.

### Recent Service Tickets

A table of the 8 most recently created SRs.

| Column | What it shows |
|---|---|
| SR Number | The SR number (for example SR-2026-27-0004). |
| Serial No. | Serial number of the machine the SR is raised on. |
| Model | Machine model name. |
| Machine Type | Machine classification (Road Rail, Rail Bound, Accessories, or a custom value). |
| Client | Machine's client company. |
| Site | Machine's site name. |
| Issue Summary | SR issue title (one line, full text on hover). |
| Priority | URGENT or STANDARD, coloured. |
| Status | SR status. |
| Age | Days since the SR was opened (or created, if no opened date). |
| Warranty | "start → end" warranty dates of the machine, or "No" if either date is missing. |
| Actions | "View" label. |

**Actions:** "View all →" opens the Service Requests list. Clicking any row opens that SR's view page.

### Machine Assets

A table of 8 machines, taken after sorting all machines by serial number (natural order, so 9 comes before 10).

| Column | What it shows |
|---|---|
| Serial Number | Machine serial. |
| Model | Model name. |
| Machine Type | Machine classification. |
| Application Type | OHE, FBW, CMC - Shunting, Track Laying, or a custom value. |
| Client | Client company. |
| Site | Site name. |
| Year of Mfg. | Year of manufacture (financial-year format, e.g. 2026-27). |
| Dispatch Date | The machine's Dispatch Date (stored as delivery date). |
| Commissioning Date | Commissioning date. |
| Status | Machine status, coloured. |
| Total SRs | Number of SRs (in the loaded list) raised on this machine. |
| Warranty | "start → end" or "No". |
| Actions | "View" label. |

**Actions:** "View all →" opens the Projects list. Clicking a row opens that machine's view page.

## 3. Screens

### Projects Asset Register (/dashboard/erp/projects)

#### List view

Heading "Projects Asset Register" — "Inventory tracking of rolling machinery, catenary cars, and rail accessories."

Top buttons (right side):

- **Export** — shown if the user has Projects (Machines) › Export. Opens the Export dialog (see below).
- **Import** — shown if the user has Projects › Import and Projects › Create. Opens the Import Machines dialog (see below).
- **+ Add New Project** — shown if the user has Projects › Create. Opens the Add New Project form.

Stat cards (computed from the currently loaded, filtered list):

| Card | What it shows |
|---|---|
| Total Machines | Number of machines in the list. |
| Total Active Machines | Machines with status Active. |
| Under Service | Machines with status Under Service. |
| Standby | Machines with status Standby. |

Filters panel:

| Filter | Type | Behaviour |
|---|---|---|
| Search Registry | text | Searches serial number, model name and client company (contains, case-insensitive). Runs automatically 0.3 seconds after typing stops. |
| Machine Status | dropdown | All Statuses, or one of Active, Under Service, Manufacturing Under Progress, Work in Progress, Standby, Inactive, Decommissioned, Cancel. |
| Application Type | dropdown | All Applications, OHE (Overhead Equipment), FBW (Flash Butt Welding), CMC – Shunting, Track Laying, Other Application. Exact match on the stored value. |
| Client Company | dropdown | All Clients, plus every distinct client company that exists in the machines the user can see (loaded from the server). If these options fail to load, a red line explains that the dropdowns are empty and why. |
| Clear Filters | button | Resets all three dropdowns and the search, and reloads. |
| Apply Filters | button | The three dropdowns are a draft; they only take effect when Apply Filters is pressed. |

Sort: machines are always sorted by serial number in natural order. The list loads up to 5,000 machines; there is no paging.

| Column | What it shows |
|---|---|
| Serial No. | Machine serial number (orange). |
| Model | Model name, or "—". |
| Machine Type | Machine classification. |
| Application Type | Application type. |
| Client | Client company. |
| Site | Site name. |
| Year of Mfg. | Year of manufacture. |
| Dispatch Date | Dispatch date. |
| Commissioning Date | Commissioning date. |
| Status | Machine status in words. |
| SRs | Number of SRs on this machine (counted from up to 1,000 SRs loaded alongside). |
| Warranty | "start → end" warranty dates or "No". |
| Actions | "View" and, if the user has Projects › Edit, "Edit". |

Row actions: clicking a row (or View) opens the machine's view page; "Edit" opens the edit form. Page links use a signed reference instead of the raw record id; an altered link shows an "Invalid link" message with a "Back to projects" link.

If the list fails to load, a "Failed to Load Asset Register" dialog shows the real reason with a "Reload" button.

#### Import Machines dialog

Opened from **Import**. The user can download a CSV template ("machines_import_template.csv"), then upload a .csv or .xlsx file using the template's columns. Only serial_number is required. Rules shown in the dialog and enforced by the server:

- A row whose serial number is already registered (ignoring case and spaces, including machines in the Recycle Bin) is a duplicate and is not saved.
- A new serial whose engine number or chassis number already belongs to another machine is listed as a problem.
- Existing machines are never overwritten — you can export, edit and import the same sheet; existing rows are skipped.

The result is shown in three blocks — "Saved", "Duplicates — not saved" (with the machine it matched and why) and "Problems — not saved" (with how to fix) — and can be downloaded as "machine_import_report.csv". Template / import columns: Serial Number, Machine Type, Model Name, Engine Number, Chassis Number, Application Type, Status, Year of Manufacture, Software Version, PO Number, PO Date, Delivery Date, Commissioning Date, Handover Date, Client Company, Client Name, Client Designation, Client Email, Client Phone, Client Phone Alt, Client Address, Client GST, Site Name, Site Location, Site State, Site Pincode, Site Country, Zone, Is Export, Warranty Start Date, Warranty End Date, Warranty Override, Extended Warranty, Extended Warranty End, AMC Status, AMC End Date, Operator Name, Operator Phone, Operator Email, Operator Qualification, Specifications, Installed Options, Notes, Tech Notes, Warranty Terms.

#### Export dialog

Opened from **Export**. Produces an Excel file ("machines.xlsx") with the same columns as the import template. Two modes:

- **All** — every machine matching the list's current search and filters, optionally narrowed by "Dispatch date from (optional)" and "Dispatch date to (optional)" (both dates included; either can be left blank).
- **Selective** — a searchable list of machines with checkboxes ("Select all shown", "Clear"); only ticked machines are exported. The button reads "Export N selected".

#### Create form (Add New Project — /dashboard/erp/projects/new)

Opened only by users with Projects › Create (others are redirected to the Projects list). Header "Projects › Registration", title "Add New Project", "← Back" button top-right. The form is split into five tabs: Machine Identity, Client & Site, Technical Specs, Timeline & Warranty, Documents. Buttons at the bottom: Cancel, Previous (from tab 2), Next (until the last tab) and **Save Project** (available on every tab). If a check fails, a "Cannot Save Machine/Project" dialog shows the reason and the form jumps to the tab with the problem.

Tab 1 — Machine Identity (section "Machine Asset Identity"):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Serial Number | text | Yes | Free text, e.g. PNR-RR-2026-88 | Must not be blank. Must be unique across all machines, including the Recycle Bin — otherwise the server says which machine already uses it. |
| Model Name | text | No | Free text | — |
| Machine Classification | dropdown | No | Road Rail, Rail Bound, Accessories, Other | Choosing Other shows "Custom Class Specification". |
| Custom Class Specification | text | Yes when Other is chosen | Free text | Saved as the machine type in place of "Other". |
| Engine Number | text | No | Free text | — |
| Chassis Number | text | No | Free text | — |
| Year of Manufacture | text (financial year) | No | Format YYYY-YY, e.g. 2026-27 (auto-formats as you type) | Second part must be the next year (2026-27 valid, 2026-28 invalid). Checked on screen and on the server. |
| Operational Status | dropdown | Yes (defaults to Active) | Active, Under Service, Manufacturing Under Progress, Work in Progress, Standby, Inactive, Decommissioned, Cancel | Server only accepts these values. |
| Application Type | dropdown | No | OHE, FBW, CMC - Shunting, Track Laying, Other | Choosing Other shows "Custom Application Specifications". |
| Custom Application Specifications | text | Yes when Other is chosen | Free text | Saved as the application type. |
| Production Notes & Core Details | text area | No | Free text | Shown on the view page as "Production Notes". |

Tab 2 — Client & Site, section "Operational Site Location":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| International / Export Deployment | checkbox | No | On / Off | On: State is replaced by a free-text Country field and State is cleared. Off: Country is reset to India. |
| Site Name | text | No | Station / site name | — |
| Site Location | text | No | City or division | — |
| State | dropdown (when not export) | No | All Indian states and union territories | — |
| Country | text (when export) | No | Free text; defaults to India | — |
| Pincode | text | No | 6-digit PIN code (placeholder only) | No format check. |
| Zone | text | No | e.g. Northern Railway (NR) | — |

Section "Client Details":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Client Company | text | Yes | Free text | Must not be blank (checked on screen). |
| Contact Person | text | No | Free text | — |
| Designation | text | No | e.g. Chief Engineer | — |
| Email | email | No | Free text | Must be a valid email format (screen and server). |
| Phone | phone | No | e.g. +91 98765 43210 | If filled, 7 to 15 digits. |
| Alternate Phone | phone | No | — | If filled, 7 to 15 digits. |
| GST Number | text | No | 15-digit GSTIN, converted to capitals | Must be a valid GSTIN format (screen and server). |
| Address | text area | No | Client billing address | Used as the default "To" address on letters. |

Section "Operator Details":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Operator Name | text | No | Free text | — |
| Phone | phone | No | — | If filled, 7 to 15 digits. |
| Email | email | No | — | Valid email format. |
| Qualification | text | No | e.g. Certified Loco Pilot | — |

Tab 3 — Technical Specs (section "Technical Specifications"):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Specifications | text area | No | Engine power, capacity, key metrics | — |
| Installed Options | text area | No | Special modular items installed | — |
| Software Version | text | No | e.g. v2.4.1 | — |
| Notes | text area | No | Additional engineering notes | Shown on the view page as "Engineering Notes". |

Tab 4 — Timeline & Warranty, section "Procurement & Delivery Information":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| PO Number | text | No | Customer purchase order reference | Pre-fills the LOA / PO reference on delivery documents. |
| PO Date | date | No | Date picker | — |
| Dispatch Date | date | No | Date picker | Entering or changing it fires the "Machine dispatched" notification rule. |
| Commissioning Date | date | No | Date picker | — |
| Handover Date | date | No | Date picker | — |

Section "Warranty Coverage Details":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Warranty Status | dropdown | No | No Warranty, Active Warranty Period | Not stored itself. "Active Warranty Period" shows the two date fields; "No Warranty" clears both warranty dates on save. |
| Warranty Commencement | date | No | Shown only for Active Warranty Period | Stored as warranty start date. |
| Warranty Expiration | date | No | Shown only for Active Warranty Period | Stored as warranty end date; drives the Warranty Status card (Active / Expired). |
| Warranty Terms & Scope | text | No | Clauses, limit conditions | Stored in the "warranty override" field (max 50 characters in the database). |
| Extended Warranty | checkbox | No | On / Off | On shows "Extended Warranty End". Off clears the extended end date. |
| Extended Warranty End | date | No | — | — |
| AMC Service Status | dropdown | No | None, Active AMC, Expired Contract | Choosing a value shows AMC End Date. |
| AMC End Date | date | No | — | — |

Tab 5 — Documents (section "Attachments & Documents"):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Files | file (multiple, drag & drop or click) | No | PDFs, Office files, images, videos — "max 10GB each" | Files are queued and listed with a Remove link; they upload to SharePoint after the machine is saved. Upload needs Projects › Edit and fails with a clear message if SharePoint storage is not configured. |
| Make private (only you, admins, and people/departments/designations you choose can see this) | checkbox | No | Shown once at least one file is queued | When ticked, three pickers appear: "Share with specific people" (search the user directory), "Or share with entire department(s)" and "Or share with entire designation(s)". Anyone matching any one pick can see the file. |

On save: the machine is created; if Service → Settings "New machines need approval" is on, it starts as Pending approval and is sent to the approval engine (if no approver stage applies it is approved at once). An audit entry is written, the "Machine registered" notification rule fires, every other user gets a bell broadcast "New Machine Registered", and if a Dispatch Date was entered the "Machine dispatched" rule also fires. The user is taken to the new machine's view page.

Fields that exist in the database but are not on this form: Third-party inspection required and Inspection agency (used by Quality to block dispatch until an inspection call is accepted) and Warranty Terms (long text, import only).

#### View page (/dashboard/erp/projects/(signed ref))

Header: the serial number in large text, a status badge (green for Active, red for every other status), and below it "model name · client company".

Header buttons:

| Button | When it appears | What it does |
|---|---|---|
| ← Back | Always | Returns to the Projects list. |
| + New Service Request | User has Service Requests › Create and the machine's approval status is Approved | Opens the Create Service Request form (the machine is not pre-selected; pick it in the form). |
| Edit Project | User has Projects › Edit | Opens the edit form. |
| Delete | User has Projects › Delete and created this machine (admins: any machine) | Asks "Delete this machine?" — "It can be restored from the recycle bin for 10 days." |

Approval banners:

- **Pending approval** (approval status Pending) — "Service requests can't be raised on this machine until it is approved." For a machine sent for approval before the central approval engine was introduced, the banner itself shows "Approve machine" and "Reject" buttons (reject asks for a reason; the server checks the user was one of the original approvers).
- **Rejected** — shows the rejection remarks and "Edit the machine to correct it — saving sends it back for approval."
- **Machine approval** panel (shared approval panel) — shows the live approval request from Organization › Approval Workflows › New machine, with the approve / reject actions for the current approver.

KPI cards:

| Card | Meaning |
|---|---|
| Active Tickets | Number of this machine's SRs not Closed or Cancelled, with "No open repair requests" or "N open repair request(s)". |
| Warranty Status | "Active — Valid until (end date)", "Expired — Expired on (end date)", or "—  No warranty on record" when there is no warranty end date. |

Tabs on the view page:

Overview tab — four cards (plus a fifth when notes exist):

| Field | Meaning |
|---|---|
| Machine Identity: Machine Type, Application Type, Engine Number, Chassis Number, Year of Manufacture | From the identity tab of the form. |
| Timeline: PO Date, Dispatch Date, Commissioning Date, Handover Date | Order and delivery milestones. |
| Client & Site: Client Company, Contact Name, Contact Designation, Contact Email, Contact Phone, Alternate Phone, Client GST, Site, Site Location, Site State, Site Pincode, Site Country, Zone, Export Deployment (Yes/No) | Customer and installation location. |
| Warranty & AMC: Warranty Start, Warranty End, Warranty Terms, Extended Warranty ("Yes (until date)" or "No"), AMC Status, AMC End Date | Cover details. |
| Production Notes | The "Production Notes & Core Details" text (only if filled). |

Empty values show "Not provided".

Technical Specs tab:

| Field | Meaning |
|---|---|
| Operator Details: Operator Name, Operator Phone, Operator Email, Qualification | Customer's machine operator. |
| Technical Specifications: Software Version, Installed Options, Specifications, Engineering Notes | Technical data from the form. |

Maintenance History tab — table of every SR on this machine: SR Number (link to the SR), Issue, Priority, Status, Created. Shows "No service requests raised for this machine yet." when empty.

Production tab — Production work orders building this machine: Work Order, Product, Built / Planned (with percent), Planned End (red with "· overdue" if late), Status (Draft, Released, In Progress, Completed, Closed, Cancelled). The work order number is a link only for users who have the Production app. Shows "No production work orders are linked to this machine." when empty.

Documents tab — two views switched by buttons "Uploaded (count)" and "Created (count)":

- **Uploaded** — users with Projects › Edit see a drag-and-drop area (PDF, DOCX, XLSX, JPG/PNG, MP4); picked files are staged for review and uploaded on confirm (uploads from this tab are not private). Each document is listed by file name (click to open). A "Delete" button shows for users with Projects › Delete who uploaded that file (admins: any). Private documents can only be opened by the uploader, people/departments/designations they were shared with, or admins.
- **Created** — letters and delivery documents generated for this machine. "+ Create New" appears for users with Projects › Edit and opens the Create Document dialog (below). Each row shows the subject (a link), a type badge (except General Letter), the reference number, date and creator. Clicking the subject opens the Word document for editing (Edit + Print users) or the PDF (Print-only users); without Print permission it shows an error asking for Print permission. Row buttons: **PDF** (Print permission), **Edit** (Edit permission), **Delete** (Delete permission and creator, admins any — "This cannot be undone; its reference number will not be reused."). Under each row the managed Word document panel offers "Create Word" / "Create Word for current revision", "Edit in Word", "Upload revised .docx" and "Download .docx", and shows whether the Word file was edited after it was generated.

Audit Trail tab — every logged action on the machine (registered, updated with changed field names, approved/rejected, attachments uploaded, letters created/edited/deleted, deleted/restored), each with who did it and when. Shows "No audit history yet." when empty.

#### Create Document dialog (letters)

Opened from Documents › Created › "+ Create New" or a letter's "Edit". First the user picks the document type:

| Type | Purpose |
|---|---|
| Delivery Cover Letter | Goes with the machine — lists the documents handed over (invoice, guarantee, test reports…). |
| Delivery Confirmation | Delivery note listing every delivery challan; the customer signs it as proof of delivery. |
| Guarantee Certificate | Quality guarantee against the LOA — months from commissioning / supply, whichever is later. |
| General Letter | Free-form letter on the letterhead — own subject and body. |

Delivery documents are created as an editable Word document on the company letterhead in two copies — Original for Recipient and Duplicate for Supplier. The reference number is assigned on save as (serial number)/LTR/001, 002 … per machine; numbers of deleted letters are never reused. A letter's type cannot be changed after creation.

General Letter fields:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Date | date | Yes | Defaults to today | — |
| Subject | text | Yes | e.g. Commissioning of machine PEW-62-2 | Max 300 characters. |
| To | text area | Yes | Pre-filled from the machine's contact name, designation, company and address, one per line | — |
| Letter | text area | Yes | Starts with "Dear Sir/Madam," | Blank line between paragraphs. |

Delivery Cover Letter / Delivery Confirmation fields ("Machine & order particulars" pre-filled from the machine and from this machine's last delivery document):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project | text | No | e.g. IRCON MAHSR-T2 Project | — |
| Client | text | Yes | Machine's client company | — |
| Application | text | No | Machine's application type | — |
| Vehicle | text | No | Machine's machine type | — |
| Model No. | text | No | Machine's model name | — |
| Serial No. | read-only | — | From the machine record | Change it on the machine if wrong. |
| LOA / PO reference | text | Yes | Machine's PO number and PO date ("PO DATE. dd/mm/yyyy") | Include amendments if any. |
| Invoice No. | text | Yes | e.g. INV/P1/26-27/005 | — |
| Invoice Date | date | No | — | — |
| Date | date | Yes | Today | — |
| Delivery Note No. | text | Yes (Delivery Confirmation only) | e.g. DN/P1/26-27/03 | — |
| Received on behalf of | text | No | Machine's client company | Customer organisation that signs the receiving copy. |
| Statement | text area | No | Default wording about delivery as per the Letter of Agreement | — |
| Delivery challans (Delivery Confirmation only) | repeating lines: challan no. + item delivered | Yes, at least one | e.g. DC/P1/26-27/0165 | Every filled line needs both values. |
| Documents handed over (Delivery Cover Letter only) | repeating list | Yes, at least one | Defaults: Invoice showing LOA reference, Manufacturer's/Contractor Guarantee Certificate, Inspection & Test reports, Delivery Confirmation, Packing List | — |

Guarantee Certificate fields ("Guarantee details"):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| LOA / PO reference | text | Yes | Pre-filled from PO number and date | — |
| Date | date | Yes | Today | — |
| To | text area | Yes | Pre-filled from the client contact | — |
| What is guaranteed | text | Yes | Defaults to "(vehicle) for (project)" | Printed in the guarantee sentence. |
| Months from commissioning | number | Yes | Default 18 | Whole number above 0. |
| Months from supply | number | Yes | Default 24 | Whole number above 0; whichever period ends later applies. |

All types also have **Signatory Name** and **Signatory Designation**. The default signatory is a company Partner (Organization → Company Info → Partners) — the logged-in user if they are a partner, otherwise the first partner by name; failing that, whoever signed the most recent letter; otherwise the logged-in user. "Sign as partner" buttons fill in any partner. If no partners exist, a hint says an admin can add them.

Buttons: Cancel, **Save**, **Save & Edit in Word** (saves and opens the Word document; if only the Word step fails, the letter is still saved and the error says so), and "← Back" to change the type before the first save. Editing a saved letter with changes increases its revision, so a new Word document is needed for the current revision.

#### Edit (/dashboard/erp/projects/(signed ref)/edit)

Only for users with Projects › Edit (others are sent back to the view page). Title "Edit Project — (serial)". The same five-tab form is shown, filled with current values; the button is **Save Changes**. All fields are editable. Clearing a field clears the stored value (for example switching Warranty Status to No Warranty removes the warranty dates). Files added on the Documents tab are uploaded after the save.

Locks and rules on save:

- Serial number must stay unique.
- If the machine is linked to a Production RRV build whose RRV Completion is signed off, the serial is frozen until that stage is reopened in Production.
- If the linked RRV build has been handed over to the customer, only an admin can change the serial (recorded in the audit log as an admin override). While a linked build is still open, its vehicle serial is updated to match.
- A legacy status value saved before the fixed list existed can stay; any new status must come from the fixed list.
- If the machine was Rejected and approvals are switched on, saving any change re-sends it for approval.
- If anything changed: an audit entry lists the changed fields, the "Machine updated" notification rule fires, and if the Dispatch Date changed the "Machine dispatched" rule fires.

#### Statuses & workflow

Machine operational status (chosen by the user, fixed list): Active, Under Service, Manufacturing Under Progress, Work in Progress, Standby, Inactive, Decommissioned, Cancel. Production also sets Manufacturing Under Progress and Active on machines it creates. There are no automatic transitions between these.

Machine approval status: Approved (default; also every machine created by Production or before approvals existed), Pending, Rejected.

1. With "New machines need approval" on, a newly registered machine becomes Pending and is sent to Organization › Approval Workflows › New machine (default approvers: portal admins; if no approver is configured the approval is skipped and the machine is Approved immediately).
2. The approver approves (machine becomes Approved; SRs can now be raised) or rejects / returns with a reason (machine becomes Rejected and the reason is shown on the page). If the request is withdrawn, the machine becomes Rejected with the note "Approval request withdrawn — edit and save the machine to send it again."
3. A Rejected machine is corrected by editing; saving sends it back for approval.
4. While Pending or Rejected, no service request can be raised on the machine (the server refuses with the reason).

Delete: soft delete to the Recycle Bin, allowed only for users with Projects › Delete who created it (admins any). Delete is blocked if the machine is linked to a live RRV build, Production work order or Sales order schedule (cancel or unlink those first), or if it has any posted Store material issue (set it to Decommissioned or Inactive instead). Deleting a machine also moves all its SRs to the Recycle Bin and withdraws any live approval requests; all other users get a "Machine Deleted" bell broadcast.

### Service Request Registry (/dashboard/erp/service-requests)

#### List view

Small heading "Service Operations", title "Service Request Registry", and "(N) Service Requests Found".

Top buttons:

- **Export** — needs Service Requests › Export. Opens the Export dialog (file "service_requests.xlsx"); All mode can be narrowed by "Reported date from / to"; Selective mode ticks individual SRs. The sheet starts with SR Number, then the import columns, then Material Cost, Tax Amount and Total Bill.
- **Import** — needs Service Requests › Import and Create. Opens "Import Service Requests" (see below).
- **+ New Service Request** — needs Service Requests › Create.

Filters (applied immediately):

| Filter | Type | Behaviour |
|---|---|---|
| Search | text | "SR#, title, serial, client..." — searches SR number, issue title, description, category, machine serial and machine client contact name. Runs 0.3 seconds after typing stops. |
| Status | dropdown | All Statuses or one of the 11 SR statuses. |
| Priority | dropdown | All Priorities, Standard, Urgent. |
| Service Type | dropdown | All Service Types or one of the 6 service types. |
| Overdue Only | checkbox | Shows only SRs whose Expected Close Date has passed and which are not Closed or Cancelled (filtered on screen). |
| Clear | button | Resets search and all filters. |

Sort: newest created first. Up to 1,000 SRs are loaded.

| Column | What it shows |
|---|---|
| SR Number | SR number (orange). |
| Machine Serial | Serial of the machine. |
| Client & Site | Machine's client company, with site name below. |
| Issue Summary | Issue title, one line, full text on hover. |
| Service Type | Service type label, or "Not set" for old SRs. |
| Priority | URGENT / STANDARD, coloured. |
| Status | Coloured status pill (e.g. Open / Reported blue, In Progress orange, Pending Parts red, Closed green). |
| Opening Date | Date the SR was opened. |
| Closing Date | Date closed, or "Open". |
| Resolution Time | For closed SRs: days from opening to closing ("Same day", "1 day", "N days"). For open SRs: "Open · N days" since opening. |
| Warranty | Machine's "start → end" warranty dates or "No". |
| Actions | "View", plus "Edit" for admins or for the SR's creator who holds Service Requests › Edit. |

Row click opens the SR view page.

#### Import Service Requests dialog

Upload .csv or .xlsx; machine_serial_number, issue_title and service_type are required. Used for new SRs (status Open) or old SRs from the previous system (status Closed with Corrective Action, dates and costs). A row is a duplicate and is not saved when its old_sr_number was already imported, or the same machine already has an SR with the same issue title on the same reported date. SR numbers are generated automatically and no client emails are sent. Results are shown as Saved / Duplicates / Problems and can be downloaded as "service_request_import_report.csv". Columns: Machine Serial Number, Old SR Number, Issue Title, Issue Description, Service Type, Priority, Status, Issue Category, Sub Category, Failure Mode, Reported Date, Reported By Name, Reported By Phone, Reported By Email, Assigned To, Expected Date to Attend, Expected Completion Date, Actual Date Attended, Actual Completion Date, Closed Date, Actual Service Duration Hours, Downtime Hours, Root Cause, Corrective Action, Preventive Actions, Service Report Notes, Customer Feedback, Customer Satisfaction, Customer Sign Off Name, Customer Sign Off Date, Service Cost, Transport Cost, Accommodation Cost, Miscellaneous Cost, Tax Percentage, Payment Status, Invoice Number.

#### Create form (Create Service Request — /dashboard/erp/service-requests/new)

Only for users with Service Requests › Create. Header "Service Operations › New Request", "← Back" top-right. Left column: Issue Information, Reported By, Attachments. Right column: Priority Level, Assignment. Buttons: Cancel and **Create Request**. Errors show in a "Cannot Save Service Request" dialog.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Asset / Vehicle | searchable dropdown | Yes | All machines the user can see, shown as "serial — model (client)" | The machine must exist and be Approved, otherwise the server refuses with the reason (pending, or rejected with the remarks). |
| Request Date | date (display) | — | Today | Shown only; not saved. The SR's opened date is set by the server at the moment of saving. |
| Service Type | dropdown | Yes | Installation & Commissioning, Warranty, AMC, Repair / Breakdown, Inspection / Maintenance, Paid Service | A hint under the row explains the chosen type (e.g. "Customer pays for the service outside warranty/AMC"). |
| Issue Category | dropdown | No | Mechanical, Electrical, Hydraulic, Pneumatic, Engine, Software, Other | Used in the Reports "Top Issue Categories" chart. |
| Site / Location | text | No | Current location of the asset | Not a separate field — appended to the description as "Location: (text)". |
| Issue Title | text | Yes | Brief summary of the fault | — |
| Detailed Description | text area | Yes | Symptoms, context, impact | — |
| Company / Client Name (Reported By) | text | No | Free text | — |
| Phone (Reported By) | phone | No | — | If filled, 7 to 15 digits. |
| Email (Reported By) | email | No | — | Valid email. This is the address that receives the client "registered" and "completed" emails. |
| Attachments | file (multiple) | No | Images, videos, PDFs, Office documents | Queued with Remove links; uploaded to SharePoint after the SR is created. |
| Priority Level | radio | Yes | Standard ("Normal service request"), Urgent ("Needs faster attention") | — |
| Assign To Engineer | text (locked) | — | Always the logged-in user's name (no picker) | Saved as the assigned engineer name. |
| Expected Attend Date | date | No | — | — |
| Expected Close Date | date | No | — | Drives the "Overdue Only" filter. |
| Initial Status | dropdown | Yes (default Open / Reported) | All statuses except Closed | A new SR cannot start as Closed (server also refuses). |
| Notes | text area | No | Any additional notes | Shown as "Service Notes". |

On save the server gives the SR its number in the financial-year series SR-(FY)-0001, e.g. SR-2026-27-0001 (the year runs April to March), records the opened date and creator, writes an audit entry, sends all other users a "New Service Request Raised" bell broadcast, sends the creator a "Service Request Created" bell, fires the "Service request raised" notification rule, and in the background emails the client (if a Reported By email exists) "Service Request Registered — (SR number)" and the internal team mailbox "[New SR] (SR number) — (title)". Each of these emails is sent at most once per SR.

#### View page (/dashboard/erp/service-requests/(signed ref))

Header: SR number (small) and the issue title (large). Buttons:

| Button | When it appears | What it does |
|---|---|---|
| ← Back | Always | Returns to the SR list. |
| Edit | Admin, or the SR's creator holding Service Requests › Edit | Opens the edit form. |
| Delete | Service Requests › Delete and creator (admins any) | "Delete this service request?" — restorable from the recycle bin for 10 days. Blocked if the SR is locked. |

Closure approval: when the SR is in Review and "Closing a service request needs approval" is on, a "Closure awaiting approval" banner says "The work is reported done. An approver closes it or sends it back to In Progress." For an SR sent to Review before the central approval engine, the banner has "Approve & close" and "Send back" buttons (send back asks what still has to be done). The shared "Closure approval" panel shows the live approval request and its approve / reject actions.

Workflow stepper: ten numbered circles — Reported, Acknowledged, Assigned, Scheduled, In Progress, Pending Parts, On Hold, Work Completed, Review, Closed. Earlier steps show a green tick, the current step is orange. A user who can edit the SR (and the SR is not locked) can click any other step to change the status. A cancelled SR shows a "Cancelled" strip instead of the stepper. Every status change asks for confirmation in an "Update Status" dialog; for Closed it warns that Corrective Action must be filled and the client is emailed.

Tabs: Overview, Diagnostics & RCA, Materials, Attachments, Audit Trail.

Overview tab, left column:

| Field | Meaning |
|---|---|
| Issue Details: Category, Description | Issue category and full description (including any "Location:" line). |
| Reported By: Name, Phone, Email | Client contact who reported the issue. |
| Status, Type & Priority: Status | Dropdown of all statuses incl. Cancelled; changing it asks for confirmation. Disabled if the user cannot edit or the SR is locked. |
| Status, Type & Priority: Service Type | Dropdown; saves immediately. Shows "Not set — select one" for old SRs without a type. |
| Status, Type & Priority: Priority | Standard / Urgent dropdown; saves immediately. |

Execution & Billing card (editable by users who can edit the SR when not locked; otherwise read-only):

| Field | Meaning / rule |
|---|---|
| Actual Attended | Date the engineer actually reached the machine. |
| Actual Completed | Date the work actually finished; cannot be before Actual Attended. |
| Service Cost (₹) | Number, 0 or more. |
| Transport Cost (₹) | Number, 0 or more. |
| Accommodation Cost (₹) | Number, 0 or more. |
| Miscellaneous Cost (₹) | Number, 0 or more. |
| Tax % | Number between 0 and 100 (enter 0 if not taxed). Database default is 18. |
| Invoice Number | Free text. |
| Payment Status | Not set, Not billable (warranty / free), Pending — to be invoiced, Invoiced, Paid. |
| Material Cost | Read-only: sum of the estimated budgets of the SR's materials. |
| Tax Amount | Read-only: (service + transport + accommodation + miscellaneous + material) × Tax % / 100. |
| Total Bill | Read-only: that subtotal plus the tax amount. |

**Save Billing** is enabled only when something changed; totals are recalculated by the server on save. A locked SR shows "This service request is locked — ask an admin to unlock it to change billing."

Overview tab, right column:

| Field | Meaning |
|---|---|
| Asset Context: Machine | "serial — model" of the machine (or the reason it could not be loaded). |
| Asset Context: Site / Location | Machine's site name. |
| Asset Context: Request Date | Date the SR was created. |
| Assignment | Engineer name with initials avatar; Opened, Expected Attend, Expected Close, Closed dates. |
| Service Notes | The Notes text. |

Diagnostics & RCA tab — card "Root Cause Analysis" with three text areas: **Root Cause**, **Corrective Action** (required before the SR can be closed) and **Preventive Recommendation**. **Save RCA** appears for users who can edit (not locked) and is enabled when something changed.

Materials tab:

- "New Purchase Requisition" form (for users who can edit, SR not locked): "Project is taken from this service request. No approval needed — it goes straight to Purchase."

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Purchase Requisition Category | dropdown | Yes | Procurement PR categories, shown as "label (code)" | Must be a valid category. |
| Required Date | date | No | — | — |
| Requirement Type | dropdown | No | Procurement requirement types; defaults to "Service" | Must be a valid type. |
| Item (from Item Master) | searchable dropdown per line | Yes | Active Store Item Master items, "code — name · part no." | Every line must be an Item Master item; a new part must first be added in Store › Item Master (link opens in a new tab, then "refresh items"). |
| Make | text per line | No | Defaults to the item's make | — |
| Part Code, UOM, Category | read-only per line | — | From the Item Master | — |
| Qty | number per line | Yes | Default 1 | More than 0. |
| Project/Inhouse | dropdown per line | Yes | Project, Inhouse (default Project) | — |
| Ship To | text per line | No | — | — |
| Priority | dropdown | Yes | Low, Medium (default), High | — |
| Remarks | text area | No | — | Saved as the PR reason and as each material's description. |
| Supporting Documents | file (multiple) | No | — | Uploaded to the PR after it is raised. |
| Specification / Reference File | file (multiple) | No | — | Uploaded to the PR after it is raised. |

"+ Add Item" adds lines; "Remove" deletes a line. **Submit Purchase Requisition** creates one material line on the SR per item and a Procurement Purchase Requisition already in Approved status (no PR approval step), with the project label "serial — model", the requester and department of the logged-in user, the auto-assigned buyer for the category, and the remark "Raised from ERP Service Request (SR number)". The normal stock check and line routing of an approved PR run, Procurement users get a "New Purchase Requisition" bell, and the Purchase mailbox is emailed. A success line shows "Purchase requisition (number) raised — the Purchase department has been notified." A PR cannot be raised on a Closed or Cancelled SR.

- Materials table:

| Column | What it shows |
|---|---|
| Material | Item name and description. |
| Photos | "Photos (count)" button that expands a photo gallery under the row. |
| Part No. | Part number (or item code). |
| Qty | Quantity. |
| Status | Pending, Issued or Returned badge. It becomes Issued when the full quantity is marked received. |
| PR | "PR number · PR status" (Submitted, Approved, PO Raised, Partially Received, Received, Closed, Rejected, Cancelled) linking to the PR in Procurement; "—" if none. |
| Received | Users who can edit see a number box (max = quantity) and a "Mark" button while the line has a PR and is not fully received; otherwise "received/qty", with a tick when fully received. Receiving sets the line to pending / partial / received and refreshes the PR status shown. |
| (Remove) | For users who can edit (not locked): removes the line after confirmation; its cost leaves the bill. The server blocks changing or removing a line that is held by a live PR. |

The photo gallery (per material) allows "Take photo" (camera), "Browse photos" or drag & drop of JPG/PNG images only; staged photos are confirmed before upload. Each thumbnail opens the full image; users who can edit can delete a photo (also removed from SharePoint).

Attachments tab — "Attachments & Documents" with file count. Users who can edit see a drag-and-drop area (PDF, DOCX, XLSX, JPG/PNG, MP4); files are staged and uploaded on confirm. Each file name opens the file; "Delete" (users who can edit) removes it from the SR and from SharePoint after confirmation.

Audit Trail tab — every action on the SR: created, each field change with old and new value, PR raised, material received, emails sent or failed, closure approved or sent back, deleted / restored.

#### Edit (/dashboard/erp/service-requests/(signed ref)/edit)

Only for admins or the SR's creator who holds Service Requests › Edit; anyone else is sent back to the view page. Title "Edit — (SR number)". The same form as create, with these differences:

- Asset / Vehicle is locked: shows the serial with "(can't be changed after creation)".
- The status dropdown includes Closed.
- Site / Location starts blank; anything typed is appended again to the description.
- Clearing a field clears it; cleared dates are saved as empty.
- The button is **Save Changes**; new files are uploaded after the save.

Execution & billing, RCA and materials are edited on the view page, not here. When the SR is locked, nothing can be changed (the lock flag exists for a future feature; nothing sets it today).

On save, every changed field is written to the audit trail, other users get a "Service Request Updated" bell broadcast, and the creator (if someone else edited) gets "Your Service Request Was Updated".

#### Statuses & workflow

SR statuses (fixed in code): Open / Reported, Acknowledged, Assigned, Scheduled, In Progress, Pending Parts, On Hold, Work Completed, Review, Closed, Cancelled.

1. A new SR starts with the chosen Initial Status (default Open). It cannot be created as Closed.
2. The creator (with Service Requests › Edit) or an admin can move it to any status, from the stepper, the Overview status dropdown or the edit form. There is no forced order.
3. Closing:
   - Corrective Action (Diagnostics & RCA) must be filled first.
   - If "Closing a service request needs approval" is off, the engineer closes it directly.
   - If it is on, a non-admin cannot set Closed; they set **Review**, which sends a request to Organization › Approval Workflows › Service request closure (default approvers: portal admins). The approver either approves (SR becomes Closed, closed date set) or rejects / returns (SR goes back to In Progress with the remark in the audit trail). Withdrawing the request also returns it to In Progress. Moving the SR out of Review by hand withdraws the open approval request. Admins can still close directly.
4. On closing: the closed date is recorded, the "Service request closed" notification rule fires, other users get a "Service Request Closed" bell broadcast, the closer gets a bell, and in the background the client is emailed "Service Request Completed — (SR number)" and the team mailbox "[SR Closed] (SR number) — (title)" (each at most once per SR).
5. Reopening a Closed SR (setting any other status) clears the closed date.
6. Cancelled is a side exit from the workflow.
7. Delete moves the SR to the Recycle Bin and withdraws any live closure approval.

### Reports (/dashboard/erp/reports)

Title "Reports" — "Service activity, turnaround, and revenue overview". Built from up to 1,000 SRs the user can see. Shows "No data yet." when there are no SRs. No filters and no buttons.

KPI tiles:

| Tile | How it is computed |
|---|---|
| Total Requests | Number of SRs. |
| This Month | SRs created in the current calendar month. |
| Open | SRs in Open, Acknowledged, Assigned, Scheduled, In Progress, Pending Parts or On Hold (Work Completed and Review are not counted). |
| Closed | SRs with status Closed. |
| Avg Resolution | Average days from created to closed, over SRs that have a closed date, one decimal (e.g. 3.4d). |
| Total Billed | Sum of Total Bill of all SRs, in rupees. |

Charts:

| Chart | What it shows |
|---|---|
| Status Breakdown | Donut of SR count per status. |
| Priority Breakdown | Bars for Urgent and Standard. |
| Requests — Last 6 Months | Bars of SRs created in each of the last six calendar months. |
| Top Issue Categories | Horizontal bars of the six most common issue categories ("Uncategorized" when blank). |
| Cost Breakdown | Donut of total Service, Transport, Accommodation, Material and Misc costs in rupees. |

Status Detail — a tile per status present, with its count.

### Recycle Bin (/dashboard/erp/recycle-bin)

Title "Recycle Bin" with the note "Deleted items are auto-purged after 10 days". Two sections:

| Section | Each row shows | Restore button |
|---|---|---|
| Deleted Projects | Serial number; model · client; "Deleted (date)". | Shown to users with Recycle Bin › Edit. Restoring a machine also restores the SRs that were deleted together with it (same delete time); SRs deleted separately earlier stay in the bin. |
| Deleted Service Requests | SR number; description — "N day(s) left"; "Deleted (date)". | Shown to users with Recycle Bin › Edit who created the SR (admins any). If the SR's machine is still in the bin, the server asks to restore the machine first. |

"Nothing here." shows for an empty section. Restore errors show in a "Restore Failed" dialog with the real reason. The "day(s) left" figure counts 10 days from the delete date; no automatic purge job for this module was found in the backend code.

### Service settings (/dashboard/erp/settings)

See section 4.

## 4. Settings / Masters

Route /dashboard/erp/settings, title "Service settings", with a "← Back" to the dashboard. Built on the shared module-settings page: each setting has a help text, a Save bar and "Reset to default" (resets are written to the audit log). Viewing needs Settings › View; changing needs Settings › Edit.

Group **Approvals**:

| Setting | Type | Default | What it controls |
|---|---|---|---|
| New machines need approval | on/off | Off | On: a newly registered machine stays Pending approval and no SR can be raised on it until approved. Off: machines are usable as soon as they are saved. Who approves is set in Organization › Approval Workflows › New machine. |
| Closing a service request needs approval | on/off | Off | On: the engineer sets the SR to Review when work is done; an approver closes it or sends it back. Off: the engineer closes the SR directly. Who approves is set in Organization › Approval Workflows › Service request closure. |

Notification rules — one group per event:

| Event | Fires when |
|---|---|
| Machine registered | A new machine / project is registered. |
| Machine updated | Any detail of a machine is changed. |
| Machine dispatched | A machine's Dispatch Date is entered or changed. |
| Service request raised | A new service request is raised. |
| Service request closed | A service request is closed. |

Each event has four settings: **Send this notification** (on/off, default off), **Notify these people** (user picker), **Channels** (Portal bell, Email, Microsoft Teams; default Portal bell) and **Also email these addresses** (extra addresses such as a team mailbox, sent whenever the notification is on). The person who did the action is not notified. Saving is refused if a notification is on but nobody would receive it, if people are picked but no channel is ticked, or if an extra address is not a valid email.

The module has no master-data screens. All dropdown lists (machine types, application types, machine statuses, SR statuses, service types, issue categories, priorities, payment statuses, letter types) are fixed in code. Who may view, create, edit or delete is not set here — it is set by roles in Organization › Role & Permissions › Service & Commissioning.

## 5. Permissions

Access needs the "erp" app (Service & Commissioning). Each tab and action is a Permission Matrix grant (module erp):

| Tab key | Label | Actions |
|---|---|---|
| dashboard | Dashboard | view |
| projects | Projects (Machines) | view, create, edit, delete, export, print, import |
| service_requests | Service Requests | view, create, edit, delete, export, print, import |
| reports | Reports | view, export, print |
| recycle_bin | Recycle Bin | view, edit (edit = restore) |
| settings | Settings | view, edit |

How they are used:

| Action | Rule |
|---|---|
| See a tab in the sub-nav | View on that tab. |
| List machines / open a machine | Projects › View. Opening a machine's details is also allowed with Service Requests › View (the SR page shows its machine). |
| Register a machine | Projects › Create (old id "project_create"). |
| Edit a machine, upload machine documents, create / edit letters | Projects › Edit (old id "project_edit"). |
| Open / print a letter PDF or Word file | Projects › Print; editing the Word document also needs Edit. |
| Delete a machine, a machine document or a letter | Projects › Delete and the user created it (admins: any). |
| Import / Export machines | Projects › Import (plus Create) / Projects › Export. |
| List / open SRs | Service Requests › View. |
| Raise an SR | Service Requests › Create (old id "sr_create"). |
| Edit an SR (fields, status, billing, RCA, materials, PRs, receipts, attachments, photos) | Admin, or the SR's creator holding Service Requests › Edit. Other users only see the SR. |
| Delete an SR | Service Requests › Delete and creator (admins any). |
| Import / Export SRs | Service Requests › Import (plus Create) / Service Requests › Export. |
| Restore from Recycle Bin | Recycle Bin › Edit; for an SR, also be its creator (admins any). |
| Approve a machine / an SR closure | The approvers named in Organization › Approval Workflows (New machine / Service request closure); default stage = portal admins. No separate approve permission is needed. Items sent before the engine existed are decided by the old approver lists. |
| Change settings | Settings › Edit. |
| Send a mail test / re-send client email (server only) | Admin / SR creator with edit. |

Data scope: what a user sees is limited by their data scope for the module. For machines, "own" = machines they registered, "assigned" = machines on which they raised an SR or are the assigned service engineer. For SRs, "own" = SRs they raised, "assigned" = SRs where they are the assigned engineer. Letters, attachments and materials follow their parent machine or SR. Approvers of a live request can see that record.

Private machine documents: visible only to the uploader, the users / departments / designations it was shared with, and admins.

## 6. Documents, Notifications & Integrations

Documents generated:

- **Machine letters** (Projects › Documents › Created): Delivery Cover Letter, Delivery Confirmation, Guarantee Certificate and General Letter, on the company letterhead. Numbered (serial)/LTR/001 onward per machine. Each is a managed Word document ("Save & Edit in Word", "Edit in Word", "Upload revised .docx", "Download .docx") stored in SharePoint under ERP-Letters/(serial); the PDF is secondary and, once a Word file exists for the current revision, the PDF and .docx downloads include the Word edits. Delivery documents print two copies: Original for Recipient and Duplicate for Supplier.
- **Excel exports**: machines.xlsx and service_requests.xlsx; CSV import templates and import result reports.
- Machine documents, SR attachments and material photos are stored in SharePoint (an admin must set SHAREPOINT_SITE_ID, otherwise uploads fail with that message).

Emails:

- Client email to the SR's Reported By email: "Service Request Registered — (SR no.)" on creation and "Service Request Completed — (SR no.)" on closing. The result (sent or failed with reason) is written to the SR audit trail.
- Team email to the configured team mailbox: "[New SR] …" on creation and "[SR Closed] …" on closing.
- Purchase mailbox email when a PR is raised from an SR's Materials tab.
- Bulk-imported SRs send no emails.

Bell notifications (sent to everyone else as broadcasts unless stated):

- New Machine Registered, Machine Deleted (and a confirmation to the person who deleted).
- Machine Approved / Machine Rejected to the person who registered it (for items decided on the old approval path; the approval engine sends its own notices for new requests).
- New Service Request Raised (plus "Service Request Created" to the creator), Service Request Updated (plus "Your Service Request Was Updated" to the creator when someone else edits), Service Request Closed (plus a note to the closer), Service Request Deleted.
- SR Closure Approved / SR Closure Sent Back to the SR creator (old approval path).
- New Purchase Requisition (Procurement users) when a PR is raised from an SR.
- Configurable rules (Settings): Machine registered, Machine updated, Machine dispatched, Service request raised, Service request closed — by bell, email and/or Teams to chosen people and addresses.

Links to other modules:

- **Production**: the machine's Production tab lists work orders building it; RRV builds link to the machine and freeze / lock its serial after RRV Completion / handover; Production creates machines (status Manufacturing Under Progress / Active, approved by default). A machine linked to a live work order or RRV build cannot be deleted.
- **Sales**: a machine on a live Sales order schedule cannot be deleted.
- **Store**: PR lines are picked from the Store Item Master; a machine with posted Store material issues can never be deleted.
- **Procurement (P2P)**: Materials tab raises approved Purchase Requisitions straight to Purchase; the PR number and status are mirrored on each material line and link to the PR.
- **Quality**: the machine record carries "third-party inspection required" and "inspection agency" used to block dispatch until an inspection call is accepted (not editable on this module's form).
- **Organization**: Approval Workflows (New machine, Service request closure), Company Info → Partners (default signatory), Role & Permissions.
- **Finance**: SR billing fields (costs, tax, total bill, invoice number, payment status) are recorded for reference; there is no automatic posting.
