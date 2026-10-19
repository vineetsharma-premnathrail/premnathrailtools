# Quality Module

The Quality module controls whether material and products are good enough to use, ship or keep. Its core job is the **inspection lot**: one inspection of one quantity of one item. A lot is checked against an approved **inspection plan**, using AQL sampling (ISO 2859-1). It ends with a **usage decision** that moves stock from Quality to Free stock (accepted) or to Blocked stock (rejected). Every rejected quantity gets a **Non-Conformance Report (NCR)**. The NCR goes through disposition approvals, the action, verification and closure with its cost. On top of that the module runs:

- first article inspection (FAI) for new items, revisions and vendors
- in-process quality gates on Production routing steps
- customer / third-party inspection calls, which block dispatch until they are cleared
- CAPA in 8D form
- customer complaints
- supplier quality (approved vendor list, sampling switching, monthly vendor rating, vendor audits)
- standards, documents and a defect Pareto report

In the business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance), Quality is the **QC** step. It also reaches into its neighbours:

- **Store/Purchase:** a GRN of an inspection-controlled item opens an incoming lot. Blocked vendors cannot get new PO lines. Return-to-vendor NCRs record an RTV.
- **Production:** gated operations raise in-process lots. Receive Output raises a final lot. Production release is held while an in-house FAI is open.
- **Dispatch:** a Store "Dispatch to customer" issue is blocked without a decided final inspection and, where the contract requires it, a third-party certificate.
- **Service:** customer complaints come from the field and are traced back by batch or serial.

## 1. Navigation Tabs

The sub-nav (QualityNav) sits at the top of every Quality page, with the notification bell at its right. A tab only shows if the user has view access to that sub-tab (filterTabsByAccess with the quality permission keys in brackets).

| Tab | Route | What it opens |
|---|---|---|
| Dashboard (dashboard) | /dashboard/quality | KPI cards for lots, NCRs, CAPAs, complaints, gates, FAIs, calls and vendors |
| My Inspections (my_inspections) | /dashboard/quality/my-inspections | Open lots assigned to me, plus unassigned open lots |
| Inspection Lots (inspection_lots) | /dashboard/quality/lots | Register of all inspection lots; manual lot creation |
| NCR (ncr) | /dashboard/quality/ncr | Non-Conformance Reports register |
| Inspection Plans (inspection_plans) | /dashboard/quality/inspection-plans | Inspection plans per item and inspection type |
| Masters (masters) | /dashboard/quality/masters | Characteristics, defect codes, disposition codes, AQL sampling tables |
| In-process (in_process_inspection) | /dashboard/quality/in-process-inspection | In-process (gate) lots plus old free-text gate inspections |
| First Article (first_article) | /dashboard/quality/first-articles | First Article Inspections (FAI) |
| Inspection Calls (inspection_calls) | /dashboard/quality/inspection-calls | Customer / third-party inspection calls, contract requirements, dispatch check |
| RRV Final Inspections (final_inspection) | /dashboard/quality/final-inspection | Old free-text final inspections register |
| CAPA (capa) | /dashboard/quality/capa | Corrective and preventive actions (8D) |
| Complaints (complaints) | /dashboard/quality/complaints | Customer complaints register |
| Supplier Quality (supplier_quality) | /dashboard/quality/supplier-quality | Vendors, approved vendor list, monthly rating, vendor audits |
| Standards (standards) | /dashboard/quality/standards | Quality standards register |
| Documents (documents) | /dashboard/quality/documents | Upload and list SOPs, specifications, certificates |
| Reports (reports) | /dashboard/quality/reports | Defect Pareto |
| Settings (settings) | /dashboard/quality/settings | Numbering, thresholds, KPI targets, sampling defaults, master lists, Quality roles |

Old links that redirect automatically:

| Old route | Redirects to | Why |
|---|---|---|
| /dashboard/quality/incoming-inspection | /dashboard/quality/lots?type=incoming | Free-text incoming inspection retired in Phase 1; incoming lots come from the GRN |
| /dashboard/quality/rejections | /dashboard/quality/ncr | Free-text rejections retired; rejections are NCRs |
| /dashboard/quality/checklists | /dashboard/quality/masters | Checklists replaced by characteristics and plans |
| /dashboard/quality/in-process-inspection/new | /dashboard/quality/lots/new | Free-text in-process inspection retired in Phase 2 |
| /dashboard/quality/project-work | /dashboard/ongoing-projects (keeps ?id=) | Ongoing Projects lives in one place for every department |

## 2. Dashboard

Route /dashboard/quality. The header reads "Quality Module" / "Quality", with the subtitle "(user's department) — Inspection lots, NCRs and their dispositions, CAPA, complaints and supplier quality." The data comes from GET /quality/dashboard. Every count only covers records inside the user's data scope. While loading, each card shows "…". If there is no value it shows "—". If the load fails, a red error banner shows the real reason.

The cards appear in a grid in this order. Red cards are "bad" figures, amber cards are "warning" figures and plain cards are neutral.

### Lots waiting

- **Shows:** the number of inspection lots in status Created, In inspection or Results recorded.
- **Actions:** clicking opens My Inspections.

### Lots waiting too long (red)

- **Shows:** open lots whose lot date is older than today minus the Settings value "Lot waiting alert after (days)" (default 2).
- **Actions:** clicking opens Inspection Lots.

### Open NCRs (amber)

- **Shows:** NCRs that are not deleted and not Closed or Cancelled.
- **Actions:** opens NCR.

### Critical NCRs (red) / Major NCRs (amber) / Minor NCRs

- **Shows:** the open NCRs counted by severity.
- **Actions:** each card opens NCR.

### Dispositions awaiting approval (amber)

- **Shows:** open NCRs whose disposition status is "pending approval".
- **Actions:** opens NCR.

### Rejection rate (this month)

- **Shows:** the percentage rejected, worked out as: sum of rejected quantity × 100 ÷ sum of lot quantity. It uses lots that have a decision and a lot date in the current month, and leaves out NCR re-inspection lots. It shows 0 when nothing was received.
- **Actions:** none (the card cannot be clicked).

### Open CAPAs (amber)

- **Shows:** CAPAs in Open, Root cause found, Actions in progress, Effectiveness check or Reopened.
- **Actions:** opens CAPA.

### Overdue CAPAs (red)

- **Shows:** open CAPAs that are overdue. A CAPA is overdue when its target date has passed (unless it is at Effectiveness check), or when any of its current open actions is past its due date.
- **Actions:** opens CAPA.

### Open Complaints (amber)

- **Shows:** complaints in Logged, Under investigation, Response sent or Customer accepted.
- **Actions:** opens Complaints.

### In-process gates pending

- **Shows:** old free-text inspections in Pending or In progress, plus open lots of type In-process.
- **Actions:** opens In-process.

### First articles open (amber)

- **Shows:** FAIs in status Open.
- **Actions:** opens First Article.

### Inspection calls (7 days)

- **Shows:** scheduled inspection calls with a call date on or before today + 7 days.
- **Actions:** opens Inspection Calls.

### Vendors on watch (amber) / Vendors blocked (red)

- **Shows:** the number of distinct vendors that have an approved-vendor-list entry in status On watch, or Blocked.
- **Actions:** opens Supplier Quality.

### Vendor blocks awaiting Partner (amber)

- **Shows:** approved-vendor-list entries with a block or unblock request still pending.
- **Actions:** opens Supplier Quality.

## 3. Screens

### My Inspections — /dashboard/quality/my-inspections

This is the inspector's inbox. The note under the title says: "Open inspection lots assigned to you, plus unassigned lots anyone can pick up. Lots are created automatically from GRNs and production output for items flagged inspection on receipt."

#### List view

It uses the shared lot table (LotList) in "mine" mode. The server returns lots in status Created, In inspection or Results recorded that are either assigned to the current user or not assigned to anyone. The newest are first, up to 500.

| Column | What it shows |
|---|---|
| Lot | Lot number (format prefix-year-0001, prefix from Settings, default IL) |
| Item | Item code — item name |
| Qty | Lot quantity and unit |
| Type | Inspection type: Incoming (GRN), Job work receipt, First article (FAI), In-process, Final (production), Customer / third-party, Sales return, Stock re-inspection |
| Source | Source reference (GRN number, WO number and operation, return number…) or the source type |
| Status | Pill: Created, In inspection, Results recorded, Decision made, Closed, Cancelled |
| Assigned | Inspector name, or "Unassigned" |
| Age | Days since the lot date. It is shown in red and bold when the lot is open and older than "Lot waiting alert after (days)". Hovering shows the lot date. |
| Decision | Accept, Accept with deviation, Reject (full), Reject (partial), or — |
| (action) | View |

- **Filters:** a search box ("Search lot, item, GRN / WO number, vendor…" — it searches lot number, item name, source reference and vendor) and an inspection-type dropdown. In "mine" mode there is no status filter.
- **Row actions:** clicking the row or "View" opens the lot view page.
- **Empty state:** "Nothing waiting for you — open lots assigned to you or unassigned show here."

### Inspection Lots — /dashboard/quality/lots

#### List view

This is the same table as My Inspections, but it shows all lots within the user's data scope. A status dropdown is added (All statuses + the six lot statuses). The type filter can be pre-set from the URL (?type=incoming, used by the old incoming-inspection link). Empty state: "No inspection lots found."

- **Top button:** "+ Manual Lot" opens /dashboard/quality/lots/new.

#### Create form — New Manual Inspection Lot (/dashboard/quality/lots/new)

Incoming lots are created only by GRNs, and final lots by production output. First articles are raised from First Article. This form is for every other case. It needs the permission quality:inspection_lots:create.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Inspection type | dropdown | Yes (default Stock re-inspection) | Stock re-inspection, Sales return, In-process, Job work receipt, Final (production), Customer / third-party | The server rejects Incoming ("record the GRN in Store instead") and First article ("Raise a first article from Quality → First Article") |
| Item | searchable dropdown | Yes | Item Master (code — name) | "Pick the item to inspect." |
| Quantity (unit) | number | Yes | — | Must be greater than 0 |
| Batch / serial | text | No | — | — |
| Hold stock — move this quantity from Free to Quality stock until the usage decision | checkbox | — | Ticked by default | When ticked, the quantity is moved from Free to Quality stock (it cannot be issued meanwhile) |
| Store | dropdown | Yes when Hold stock is ticked | Store locations (code — name) | "Pick the store whose Free stock should be held in Quality…" |
| Vendor (if any) | text | No | — | — |
| Reference document | text | No | e.g. return note no. | Saved as the source reference |
| Remarks | text area | No | — | — |

**Create Lot** saves the lot (source "manual"), status Created. On save:

- The lot number is generated.
- For vendor lots (incoming, job work, FAI) the sampling state comes from the approved vendor list. Otherwise it uses the default switching state from Settings.
- "Test certificate required" is set if the item is flagged for it and the lot is incoming (or a GRN first article).
- The approved current plan is attached if one exists.
- Notifications are sent (see section 6).
- The page then opens the new lot.

#### View page — Inspection lot (/dashboard/quality/lots/(signed ref))

**Header:** the lot number, with the subtitle "Quality · (type) lot", the status pill and a "← Back" button. An invalid or edited link shows the Invalid link page with "Back to inspection lots".

**Section "Lot"**

| Field | Meaning |
|---|---|
| Item | Item code — name |
| Quantity | Lot quantity and unit |
| Source | Source type label (GRN, Work order output, NCR re-inspection, Manual, Production gate, Job work receipt) and the reference |
| Lot date | Date, with the age in days |
| Stock | "Held in Quality stock at (store)" or "No stock behind this lot" |
| Batch / serial | Batch or serial number |
| Vendor | Vendor name |
| Plan | Plan number and revision, or "No approved plan yet" |
| Sample size (max) | The largest sample size across the characteristics |
| First article link | Shown when the lot is an FAI lot: FAI number, FAI status pill, "full drawing check; approve the FAI after the decision". Clicking opens the FAI. |
| Production gate link | Shown for gate lots: WO number, operation, "the next operation is held until this lot is decided". Clicking opens the work order. |
| Sampling state | Dropdown: Normal / Tightened / Reduced. It can be changed only while the lot is Created. Changing it recalculates the sample sizes from the plan. |
| Inspector | Dropdown of users with Quality access. It can be changed while Created or In inspection. Choosing a user assigns the lot and notifies that user. |
| Test certificate / MTC | Shown only when the lot needs one. The label says "received" or "REQUIRED, not received". A text box takes the certificate or heat number, and a button "Mark received" (or "Clear" when empty) saves it. It can be edited while the lot is open. Marking it received needs a number. |

Buttons in the Lot section:

| Button | When it appears | What it does |
|---|---|---|
| Attach approved plan | Status Created and no plan attached | Re-checks for an approved current plan and copies it onto the lot. If there is still none, it shows an error. |
| Start inspection | Status Created | Moves the lot to In inspection. If no inspector is set, it assigns the person who clicked. It fails if no approved plan exists (rule 2). |
| Cancel lot | Manual lot, no stock held, status Created or In inspection | A prompt asks for a reason (required). The status becomes Cancelled and the reason is added to the remarks. |
| Close lot | Status Decision made | Sets the status to Closed. |

**Section "Results (n characteristics)"**

If the vendor is on skip-lot, a note explains that only critical characteristics (always 100%) are checked. If no plan is attached, a note explains that a Quality engineer must create, and a Quality head approve, a plan for this item and inspection type.

| Column | Meaning |
|---|---|
| Characteristic | Name, with the method underneath |
| Class | Critical / Major / Minor pill |
| Spec | For measured characteristics: nominal (min … max) and unit. Otherwise "Pass / fail". |
| Sample n / Ac / Re | Sample size / accept number / reject number, plus the AQL |
| Measured values | Measured characteristics only. A text box takes values separated by commas or spaces while the lot is editable. |
| Defective | Number box, 0 up to the sample size. For a pass/fail characteristic it is the number of defective units. For a measured characteristic it is the extra defective units found by go/no-go. |
| Defect code | Dropdown of defect codes ("— (needed if it fails)") |
| Gauge | Gauge ID text |
| Remarks | Text |
| Result | Pass / Fail pill or "Pending", with the name of the person who recorded it |

The table is editable only while the lot is Created or In inspection.

- **Save results** sends every row that has values or a defect count. If the lot is still Created, saving starts it first.
- **Validation:**
  - At least one entry is needed.
  - Values must be numbers.
  - A measured characteristic needs at least one value, and no more values than the sample size.
  - A pass/fail characteristic needs a defect count (0 if none).
  - The defect count must be between 0 and the sample size.
- **How a result is worked out:** the count of values outside min/max, plus the extra defects, compared with the accept number. Pass if the count is at or below the accept number, otherwise Fail.
- A failed row must have an active defect code.
- **Submit results for decision** (shown when the lot is In inspection) needs a result on every characteristic. It moves the lot to Results recorded and records who submitted.

**Section "Photos (n)"** — LotPhotos

- Thumbnails show the caption or file name, the linked characteristic and the uploader.
- While the lot is open (Created, In inspection, Results recorded) you can add photos:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Photos | file (multiple, images) | Yes | — | Image files only, each under 8 MB. Stored in SharePoint (Quality/Inspection-Lots/(lot number)). |
| Characteristic (optional) | dropdown | No | "Whole lot" or one of the lot's result rows | — |
| Caption | text | No | e.g. Crack at weld toe | — |

- **Add photos** uploads the files.
- **Remove** (open lots only) asks for confirmation. Only the uploader or an admin can remove a photo.
- After the decision, photos are part of the record and cannot be added or removed.

**Section "Usage decision"** (shown when the status is Results recorded)

If anything failed, a red note gives the number of failed characteristics. If a critical characteristic failed, the note says the lot can only be rejected (rule 4).

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Decision | radio | Yes | Accept, Accept with deviation, Reject (full), Reject (partial) | See the rules below |
| Accepted qty / Rejected qty | number | Yes for partial | — | Both must be above 0 and add up to the lot quantity |
| Design / customer concession no. | text | Yes for Accept with deviation | — | — |
| Remarks | text | No | — | — |

**Record usage decision** opens a confirmation that describes the stock effect (for example "… will move to Blocked stock and an NCR will be raised. A decided lot can't be edited afterwards."). Server rules:

- Only a user with quality:inspection_lots:approve (Quality engineer or head) can decide.
- Accept is not allowed if anything failed.
- Accept with deviation:
  - needs at least one failure
  - is never allowed when a critical characteristic failed
  - needs the concession number
  - needs a Quality head
  - cannot be made by anyone who recorded this lot's results (segregation of duties)
- Accepting any quantity needs all of these:
  - The first article for the item / drawing / source is released (rule 9).
  - The vendor is not Blocked for the item on the approved vendor list (incoming, job work and FAI lots).
  - The test certificate is marked received, when one is required.
- What the decision does:
  - **Stock:** if the lot holds stock, the accepted quantity moves Quality → Free and the rejected quantity moves Quality → Blocked.
  - **GRN:** for GRN lots, the accepted/rejected split is written back onto the GRN line.
  - **NCRs:** an NCR is raised automatically for any rejected quantity. A second, already-executed "use as is" NCR is raised for an accept with deviation.
  - **Supplier quality:** vendor sampling switching is updated.
  - **Gate lots:** Production is told the gate result.

**Section "Decision"** (once decided)

- Shows Decision, Accepted → Free, Rejected → Blocked, Decided by and date, Deviation and Remarks.
- Lists the linked NCRs, each with its number, severity pill and status pill. Clicking an NCR opens it.

**Section "Documents"** (once decided)

- **Inspection report:** results per characteristic, usage decision and NCRs, on the company letterhead. Buttons are "Save & Edit in Word" (primary) and "Download PDF", with the managed document panel (version history / upload) below.
- **Test certificate:** shown only when the accepted quantity is greater than 0. It certifies the accepted quantity and goes to the customer with the material. It has the same buttons.

#### Edit

There is no separate edit page.

- While Created: sampling state, inspector, test certificate, attach plan and results can all be changed.
- While In inspection: results, inspector and certificate can be changed.
- While Results recorded: only the test certificate (plus photos) can be changed, and the decision is made.
- Decided and Closed lots are never edited (rule 10). Corrections are made through an NCR or a re-inspection lot.

#### Statuses & workflow

| Status | Reached by | Who |
|---|---|---|
| Created | GRN of an inspection-controlled item; Production Receive Output; job-work material return; Production "Request Inspection" on a gated step; NCR rework/repair action (re-inspection lot); manual lot; manual FAI | System / creator |
| In inspection | Start inspection, or the first Save results | quality:inspection_lots:edit |
| Results recorded | Submit results for decision | quality:inspection_lots:edit |
| Decision made | Record usage decision | quality:inspection_lots:approve (deviation: Quality head) |
| Closed | Close lot | quality:inspection_lots:edit |
| Cancelled | Cancel lot (manual lot with no stock only, from Created / In inspection) | quality:inspection_lots:edit |

### NCR — /dashboard/quality/ncr

#### List view

Title: "Non-Conformance Reports".

| Column | What it shows |
|---|---|
| NCR | NCR number (prefix from Settings, default NCR), with "· auto" if it was raised by an inspection |
| Item | Item code — name |
| Qty | Quantity and unit |
| Severity | minor / major / critical pill |
| Source | NCR source (incoming, job work, in process, final, customer inspection, complaint, audit, internal…) |
| Disposition | Disposition type, with "(awaiting approval)" while pending, or — |
| Status | Open, Disposition decided, Action done, Verified, Closed, Cancelled |
| NCR date | Date |
| (action) | View |

- **Filters:**
  - Search (NCR number, item, vendor, description).
  - Severity (All / Critical / Major / Minor).
  - Status (All statuses, "All not closed", or each status).
  - A checkbox "Waiting for my approval", which lists NCRs whose pending disposition approval the user can act on.
- The list is sorted newest first.
- **Top button:** "+ New NCR".

#### Create form — Raise NCR (/dashboard/quality/ncr/new)

The note says rejections at an inspection lot raise their NCR automatically, so this form is for non-conformances found elsewhere. It needs quality:ncr:create.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Source | dropdown | Yes (default internal) | Settings master list "NCR sources" (Incoming inspection, Job work inspection, In-process inspection, Final inspection, Customer / third-party inspection, Customer complaint, Audit, Internal finding) | Must be an active value |
| Severity | dropdown | Yes (default Minor) | Minor, Major, Critical | — |
| NCR date | date | Yes (default today) | — | — |
| Reference document | text | No | Complaint / audit / job no. | — |
| Item (Item Master) | searchable dropdown | Item or name required | Item Master, plus "— Not a stock item —" | — |
| Item name (non-stock) | text | Required if no item is picked | — | "Pick the item from the Item Master, or type the name of a non-stock item." |
| Quantity | number | No | — | If given, must be above 0 |
| Batch / serial | text | No | — | — |
| Vendor | text | No | — | — |
| Block this quantity — move it from Free to Blocked stock | checkbox | — | Shown only when an Item Master item is picked | When ticked, the item, store and quantity are all required |
| Store | dropdown | Yes when blocking | Store locations | — |
| Defect code | dropdown | No | Defect codes (code — name (category)) | Must be active |
| Description | text area | Yes | — | "Describe the non-conformance." |

**Raise NCR** creates the NCR with status Open. If blocking was chosen, the quantity moves Free → Blocked. Alerts are sent and the automatic CAPA triggers run (see CAPA). The NCR then opens.

#### View page (/dashboard/quality/ncr/(signed ref))

**Header:** the NCR number, the subtitle "Quality · NCR" (plus "(raised by inspection)" when it was raised automatically), a severity pill, a status pill and "← Back". A step bar shows 1. Open, 2. Disposition decided, 3. Action done, 4. Verified, 5. Closed. Steps already reached are shown in green.

**Section "Non-conformance"**

| Field | Meaning |
|---|---|
| Item / Quantity / Source / Reference | As raised |
| Stock | "Blocked at (store)" or "Not holding Blocked stock" |
| Batch / serial, Vendor, Defect | As raised |
| Raised | Raised by and NCR date |
| Estimated value | Item moving average (or standard) cost × quantity |
| Inspection lot | Link to the source lot, when there is one |
| CAPA | Links to every covering CAPA, with its status |
| Description, Root cause | Text |

**Cancel NCR** appears only for a manual NCR that is Open, has no disposition proposed and holds no Blocked stock. A prompt asks for the reason. On the server:

- only a Quality head can cancel
- an NCR with a pending disposition cannot be cancelled
- auto-raised NCRs can never be cancelled

**Section "Disposition"**

- Once proposed, it shows the Disposition, the Approval state (Waiting for approval / Approved / Not proposed), Needs (the roles required), Customer approval (when required) and Remarks.
- For scrap, a note explains that scrap above the ₹ limit also needs a Partner's approval. That limit is set in Organization › Approval Workflows › NCR disposition.
- It lists the sign-offs: an Approved/Rejected pill, the role, the name, remarks and date.
- While pending on the central engine, it shows "Waiting for: (roles)". Approvers decide in the "Disposition approval" panel below.
- For older dispositions proposed before the central engine (legacy), there are "Approve as (role)" and "Reject" buttons for each pending role. Reject asks for a reason.
- While the NCR is Open, there is a proposal row:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Propose disposition (or "Re-propose (restarts approvals)") | dropdown | Yes | Active disposition codes (Masters) | The NCR must have a quantity. Return to vendor needs a vendor on the NCR. |
| Remarks | text | No | — | — |
| Contract needs customer approval | checkbox | — | Shown for Use as is / Repair | — |
| Customer approval ref. | text | Yes when the box is ticked | — | Required before proposing |

**Propose** checks that the user is a Quality engineer or head. It supersedes any earlier sign-offs, sets the disposition to pending approval, recalculates the estimated value and submits it to the central approval workflow "NCR disposition". The stages run in order, and each applies only when its condition matches:

| Stage | Applies to | Approver |
|---|---|---|
| Quality engineer | Rework, Return to vendor | quality:ncr:edit holder |
| Quality head | Use as is, Repair, Scrap | quality:ncr:approve holder |
| Design | Use as is, Repair | design:reviews:approve holder |
| Purchase | Return to vendor | Purchase head flag |
| Partner | Scrap with value above the scrap limit | Partner |

- Each approver must be a different person.
- For a major or critical NCR, anyone who recorded the lot results cannot approve as Quality engineer or head.
- On full approval, the NCR status becomes Disposition decided.
- On rejection, the disposition goes back to "not proposed".

**Approval panel "Disposition approval"** — the shared ApprovalPanel for this NCR. It shows the request stages and lets approvers approve or reject (and the requester withdraw).

**Section "Deviation approval"**

- Appears once a Use as is or Repair disposition is approved.
- It holds the managed Word document "Deviation approval": the concession record with the approving authorities, on the letterhead.
- Buttons: Save & Edit in Word / Download PDF.

**Section "Action"** (status Disposition decided, or after the action is recorded)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Document no. (label depends on type: Concession / release note no.; Rework order no.; Repair order / deviation no.; RTV / debit note no.; Scrap note no.) | text | Yes | — | — |
| Remarks | text | No | — | — |

**Record action done** (Quality engineer or head) has these stock effects:

| Disposition | Effect |
|---|---|
| Use as is | Blocked → Free |
| Rework / Repair | Blocked → Quality, and a re-inspection lot is opened (same inspection type as the source lot, or Stock re-inspection) |
| Return to vendor / Scrap | Blocked stock goes out. Return to vendor also records a P2P Return to Vendor against the GRN line, where the NCR came from a GRN lot. |

The status becomes Action done. Afterwards the section shows the Document, Done on date, Remarks and a link to the re-inspection lot.

**Section "Verification"** (status Action done)

- Fields: Verification remarks, and a **Verify** button (Quality engineer or head).
- If there is a re-inspection lot, it must have a usage decision first.
- The status becomes Verified.

**Section "Closure & cost of non-quality"** (Verified or Closed)

- Fields: material cost, rework cost and other cost (₹, not negative), and Root cause. Then the **Close NCR** button.
- Only a Quality head can close.
- A major or critical NCR needs a covering CAPA that has reached Actions in progress, Effectiveness check or Closed (rule 6). If it does not, the problem text is shown in amber above the fields.
- Once Closed, the section shows Material, Rework, Other, Total and the Closed date.

#### Edit

- PATCH edits (quality:ncr:edit) are only allowed while the NCR is Open.
- Severity cannot change while a disposition is pending approval.
- After a disposition is decided, the details are frozen.
- Deleting is only possible for a manual Open NCR with no disposition and no Blocked stock. It is a soft delete and needs delete permission. Otherwise the user must cancel instead.

#### Statuses & workflow

| Status | Reached by | Who |
|---|---|---|
| Open | Raised (auto from a lot decision, inspection call rejection or complaint investigation; or manual) | — |
| Disposition decided | Final approval of the proposed disposition in the approval workflow | Stage approvers |
| Action done | Record action done (also set straight away for an accept-with-deviation NCR) | Quality engineer / head |
| Verified | Verify | Quality engineer / head |
| Closed | Close NCR with costs | Quality head |
| Cancelled | Cancel (manual, no pending disposition, no Blocked stock) | Quality head |

### Inspection Plans — /dashboard/quality/inspection-plans

#### List view

The note says there is one approved (current) plan per item and inspection type. Approved plans are frozen, and "New revision" is used to change one.

| Column | What it shows |
|---|---|
| Plan | Plan number (IP-year-0001) |
| Item | Item code — name, or "(legacy — no item link)" |
| Inspection type | Type label |
| Rev | Revision number |
| Sampling | AQL with the AQL value and level, 100%, or Fixed |
| Lines | Number of characteristics |
| Status | draft / pending_approval / approved / obsolete pill |
| Approved | Approval date and approver |
| (action) | View |

- **Filters:** search (plan number, item name, item code), inspection type, and status (All, Draft, Approved, Obsolete).
- **Top button:** "+ New Plan".

#### Create form — New Inspection Plan (/dashboard/quality/inspection-plans/new)

It needs quality:inspection_plans:create. Defaults come from Settings → Sampling defaults.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item | searchable dropdown | Yes | Item Master | — |
| Inspection type | dropdown | Yes (default Incoming) | All 8 inspection types | Blocked if a draft or submitted plan already exists for the item and type ("edit that draft instead"), or if an approved plan exists ("use New revision") |
| Title (optional) | text | No | — | — |
| Sampling | dropdown | Yes | AQL table (ISO 2859-1), 100% inspection, Fixed quantity | — |
| AQL | dropdown | When AQL | 0.065 … 10.0 | — |
| Level | dropdown | When AQL | General I / II / III | — |
| Sample size | number | When Fixed | — | Must be above 0 for approval |

A note says critical characteristics are always inspected 100% with accept number 0. **Create draft & add characteristics** saves a Draft (no lines yet) and opens the plan.

#### View page (/dashboard/quality/inspection-plans/(signed ref))

**Header:** "(plan number) · rev (n)", the subtitle "Inspection plan · (type)", a status pill ("waiting for approval" when pending) and "← Back".

**Section "Plan":** Item, Sampling, Created by, Approved (date and approver), Title. Legacy plans with no item show a warning that they cannot be approved.

| Button | When it appears | What it does |
|---|---|---|
| Submit for approval | Draft and the user has quality:inspection_plans:submit | Validates the plan, sets it to pending approval, and submits it to the "Inspection plan" approval workflow (default stage: Quality head) |
| Approve now (Quality head) | Draft and the user has quality:inspection_plans:approve | One-click submit + approve. The plan becomes Approved and the previous approved plan for the same item and type becomes Obsolete. |
| Delete draft | Draft and the user can delete (owner rule) | Confirms, then soft-deletes the draft |
| New revision | Approved | Copies the plan as a new Draft with revision + 1 and opens it. Blocked if a draft revision already exists. Needs create permission. |
| Make obsolete | Approved (not pending / obsolete) | Confirms, then marks the plan Obsolete. Only a Quality head. New lots then have no approved plan. |

While pending, a note says the approvers decide in the Approval panel. Returned or withdrawn plans come back as drafts.

**Approval panel:** the shared ApprovalPanel for the plan.

**Section "Characteristics"** — the table columns are #, Characteristic (code — name and unit), Type (Measured / Pass/fail), Class, Nominal, Min, Max, AQL, Method and Remove. In Draft the cells are editable:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Class | dropdown | No | Default (from the characteristic), Critical, Major, Minor | — |
| Nominal / Min / Max | number | Min and/or max required for measured characteristics | — | Disabled for pass/fail. Min cannot be above max. |
| AQL | dropdown | No | Plan (inherit), or 0.065 … 10.0 | Must be in the ISO preferred series |
| Method | text | No | Placeholder is the characteristic's default method | — |

- **Add characteristic** (a dropdown of characteristics not yet on the plan) with "+ Add".
- **Save draft** saves the lines.
- A note says: "Missing a characteristic? Add it in Quality → Masters."

Approval validation checks all of these:

- the plan has an item
- the plan has at least one line
- AQL plans have a plan AQL or an AQL on every line
- a fixed plan has a sample size
- every characteristic exists and is active
- every measured line has limits

#### Edit

Only Draft plans can be edited (header and lines). Approved plans change only through New revision.

#### Statuses & workflow

Draft → Pending approval (Submit) → Approved (approval workflow) → Obsolete (a newer revision is approved, or Make obsolete).

- A rejected or withdrawn request returns the plan to Draft.
- Only Drafts can be deleted.

### Masters — /dashboard/quality/masters

Title "Quality Masters". Four tab buttons: Inspection characteristics, Defect codes, Disposition codes, Sampling (ISO 2859-1). Adding needs quality:masters:create. Retire/Reactivate needs quality:masters:edit. Codes are stored in upper case, up to 30 characters, and must be unique. Rows are never deleted; they are retired.

#### Inspection characteristics tab

New characteristic form:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Code | text | Yes | — | Unique, upper case |
| Name | text | Yes | — | — |
| Type | dropdown | Yes | Measured value (variable), Pass / fail (attribute) | — |
| Unit | text | No | e.g. mm | — |
| Method | text | No | — | — |
| Gauge type | text | No | Vernier, bore gauge… | — |
| Class | dropdown | Yes (default Minor) | Critical, Major, Minor | — |

The table columns are Code, Name, Type, Unit, Method, Gauge type, Class, Status (Active/Retired) and Retire/Reactivate. Retired rows are shown faded.

#### Defect codes tab

- New defect code fields: Code, Name and Category (dimensional, surface, material, assembly, functional, documentation).
- Table: Code, Name, Category, Status, Retire/Reactivate.
- Empty state: "No defect codes yet — results that fail need one."

#### Disposition codes tab

- New disposition code fields: Code, Name and "Acts as" (Use as is, Rework, Repair, Return to vendor, Scrap). "Acts as" decides who must approve the code and what happens to the Blocked stock.
- Default codes are seeded: UAI, RWK, REP, RTV, SCR.
- Table: Code, Name, Acts as, Status, Retire/Reactivate.

#### Sampling (ISO 2859-1) tab

- **Sample size calculator:** Lot size, AQL, Level (I/II/III), State (Normal/Tightened/Reduced) and a **Calculate** button. The result line reads "Sample n, accept a, reject r — (basis)".
- **AQL table:** a state selector (Normal (II-A), Tightened (II-B), Reduced (II-C)), then a grid with code letters as rows and AQL values as columns. Each cell shows n / Ac / Re. The table is read-only.

### In-process — /dashboard/quality/in-process-inspection

Title "In-process Inspections". The note says production routing steps marked "inspection required" raise an in-process lot when the shop floor clicks Request Inspection, and the next operation stays on hold until the lot's usage decision.

#### List view

- **Top button:** "+ Manual Lot" (opens New Manual Lot).
- **First table:** the shared lot table, pre-filtered to type In-process (all statuses, same columns and filters as Inspection Lots).
- **Second table "Earlier gate inspections":** free-text gate inspections from before lots existed. They are kept for history, and pending ones can still be finished and still release their production step.
  - Filters: search (the server matches inspection number and item name) and status (Pending, In Progress, Passed, Failed, Conditionally Passed).
  - Columns: Inspection #, Item (code), Batch, Project, Qty Inspected, Date, Status, View.

#### View page (old gate inspection) — /dashboard/quality/in-process-inspection/(signed ref)

This is an editable form. Header: inspection number and "← Back".

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item Name | text | Yes | — | — |
| Item Code, Batch Number, Project Label | text | No | — | — |
| Qty Inspected / Accepted / Rejected | number | No | — | — |
| Inspection Plan | searchable dropdown | No | In-process plans | Must exist |
| Inspection Date | date | No | — | — |
| Status | dropdown | — | Pending, In Progress, Passed, Failed, Conditionally Passed | — |
| Remarks | text area | No | — | — |
| Inspection Results (rows) | table | Rows without a parameter are dropped | SL, Parameter, Method, Acceptance Criteria, Observed Value, Result (N/A / Pass / Fail), Remove | "+ Add Result" adds a row |

- **Save Changes** needs quality:in_process_inspection:edit. It replaces all result rows. A status change notifies the work order's supervisor through Production.
- **Delete Inspection** appears when the user may delete on the tab. It asks for confirmation. The server soft-deletes the record, although the dialog says "permanently".
- A gate counts as passed for Production when the status is Passed or Conditionally Passed.

#### Gate workflow (lots)

- Production "Request Inspection" creates an In-process lot. It holds no stock, the quantity is the operation's good quantity or the WO planned quantity, and the batch is the WO number.
- For Production, the gate status reads: Created = pending; In inspection / Results recorded = in progress; Accept = passed; Accept with deviation or Partial = conditionally passed; Reject or Cancelled = failed.
- The gated operation cannot be completed, and later operations cannot start, until the gate passes.
- A failed gate can be requested again after rework.
- When the lot is decided, the WO supervisor and creator are notified. For an RRV build work order, a failed gate raises a rework order linked to the NCR.

### First Article — /dashboard/quality/first-articles

#### List view

Title "First Article Inspection". The note (rule 9) says a new item, a new drawing revision or a new vendor gets a full-drawing first article check. The first GRN, job work receipt or production output becomes the FAI lot automatically, and regular lots cannot be accepted until a Quality engineer approves the FAI.

| Column | What it shows |
|---|---|
| FAI | FAI number (prefix from Settings, default FAI) |
| Item | Item code — name |
| Source | Vendor or "In-house", with the source reference below |
| Drawing | Drawing revision(s) captured from Design (e.g. DWG-0012 rev B) |
| Why | New item, New drawing revision, New vendor, Manual |
| Lot | FAI lot number and lot status |
| Status | Open, Approved, Rejected, Cancelled |
| Decided | Decider and date |
| (action) | View |

- **Filters:** search (FAI, item, vendor, GRN / WO) and status.
- **Top button:** "+ New FAI".

#### Create form — New First Article Inspection (/dashboard/quality/first-articles/new)

Used for a sample sent ahead of the order, or for re-qualification. It needs quality:first_article:create.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item | searchable dropdown | Yes | Item Master | — |
| Vendor (empty = made in-house) | text | No | — | Vendor means an incoming FAI; empty means an in-house (final) FAI |
| Pieces | number | Yes (default 1) | — | Must be above 0 |
| Hold stock — the pieces are in a store's Free stock | checkbox | — | Off by default | — |
| Store | dropdown | Yes when Hold stock | Store locations | — |
| Reference document | text | No | e.g. sample challan no. | — |
| Remarks | text area | No | — | — |

- After an item is picked, a live note shows the requirement. It says one of: "not inspection-controlled — rule 9 does not require an FAI", "Already released…", or "FAI required: new item / new drawing revision / new vendor". It also shows the current drawing (or "No released drawing linked in Design") and any FAI already open.
- **Raise FAI** creates the FAI (status Open) and its First article lot. It is blocked if an FAI is already open for that item and source.

#### View page (/dashboard/quality/first-articles/(signed ref))

**Header:** FAI number, the subtitle "Quality · First article inspection", status pill and "← Back".

**Section "First article":** Item, Source (vendor or "In-house production"), Why, Drawing revision, Raised from, and Raised (who and date). If the item's released drawing changed after approval, an amber note says the next receipt needs a new FAI.

**Section "Full drawing check (lot)":** a link to the FAI lot with its status and decision. The note explains that the lot checks every characteristic of the item's First article plan. Without one, it uses the item's incoming or final plan on the first-article sample size (Settings), with accept number 0. Critical characteristics stay 100%.

**Section "Decision"** (while Open):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Remarks | text area | Required to reject, or when the lot was accepted with a deviation | — | — |

- **Approve FAI** (after confirmation) needs quality:first_article:approve. The lot must be decided as Accept or Accept with deviation. The FAI becomes Approved. A vendor FAI also moves that vendor from Trial to Approved on the approved vendor list for the item.
- **Reject FAI** needs a reason, and the lot must be decided first. The next receipt or run becomes a fresh FAI.
- A decided FAI never changes. Once decided, the section shows Status, Decided by and Remarks.
- **Production effect:** while an in-house FAI from another work order is still open, more production of the product cannot be released.

### Inspection Calls — /dashboard/quality/inspection-calls

Title "Customer / Third-party Inspection". Top button "+ New Call". Three tab buttons:

#### Inspection calls tab (list view)

| Column | What it shows |
|---|---|
| Call | Call number (prefix from Settings, default IC) |
| Agency | RITES, RDSO, Customer, Other (master list) |
| Order / contract | Order reference, with the machine/contract label or customer below |
| Item | Item code — name |
| Qty | Offered quantity |
| Call date | Inspection date; red and bold when it is 2 days or less away |
| Inspector | Agency inspector name |
| Status | Requested, Scheduled, Accepted, Partly accepted, Rejected, Cancelled |
| Certificate | Certificate / release note number |
| (action) | View |

Filters: search (call, item, order, certificate, customer) and status.

#### Contract requirements tab

- The note says that ticking "Third-party inspection" means finished goods for that order cannot be dispatched until an inspection call by the agency is accepted with a certificate number (rule 8). Only a Quality head can change it.
- Filters: search (serial, PO, customer, model) and "Only contracts needing inspection".
- Columns: Machine / order (ERP project label), Customer PO, Delivery, Third-party inspection (checkbox), Agency (dropdown, enabled only when ticked).
- Each change saves at once (needs quality:inspection_calls:approve). An agency is required when the box is ticked. A green "Saved for …" message confirms the save.

#### Dispatch check tab

"Can this be dispatched?" runs the same check Store runs on a "Dispatch to customer" issue.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item | searchable dropdown | Yes | Item Master | — |
| Quantity | number | Yes (default 1) | — | Above 0 |
| Batch / serial | text | Needed for items with final inspection | — | — |
| Machine / order | searchable dropdown | No | ERP machines / orders | — |

**Check** shows either "Cleared for dispatch." in green or every blocking reason in red. The reasons include:

- no batch given
- the final lot is undecided or rejected
- no decided final inspection
- more than the accepted quantity minus what is already dispatched
- the contract needs agency inspection but there is no accepted call with a certificate
- more than the cleared quantity minus what is already dispatched

#### Create form — New Inspection Call (/dashboard/quality/inspection-calls/new)

It needs quality:inspection_calls:create.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Machine / order (ERP) | searchable dropdown | This or the order ref is required | ERP projects (marked "· inspection required" when flagged) | Picking one fills in the agency from the contract |
| Customer order ref. | text | See above | Placeholder is the contract PO | Defaults to the project PO |
| Customer | text | No | Placeholder is the client company | Defaults to the project customer |
| Item | searchable dropdown | Yes | Item Master | — |
| Quantity | number | Yes | — | Above 0 |
| Batch / serial | text | No | — | Filled in from the chosen lot |
| Our final inspection lot | dropdown | No | Decided Final / First-article lots of this item with an accepted quantity | Must be the same item and accepted internally |
| Agency | dropdown | Yes (or taken from the contract) | Active inspection agencies | Must be active |
| Call raised on | date | No (default today) | — | — |
| Inspection date | date | No | — | Not before the raised date. If set, the status starts as Scheduled, otherwise Requested. |
| Inspector | text | No | — | — |
| Remarks | text area | No | — | — |

**Raise Call** saves the call and notifies the Quality engineers (bell).

#### View page (/dashboard/quality/inspection-calls/(signed ref))

**Header:** call number, the subtitle "Quality · (agency) inspection call", status pill and "← Back".

**Section "Call":** Order, Machine / contract, Customer, Item, Offered, Batch / serial, Our final lot, Agency, Raised (date and creator), Inspection date (with "in n d"), Inspector and Remarks.

While Requested or Scheduled it also has:

- Inspection date and Inspector fields
- **Schedule / Reschedule** (needs a date, not before the raised date; sets Scheduled; notifies the engineers)
- **Cancel call** (needs a reason)

**Section "Result"** (while open):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Result | radio | Yes | Accepted, Partly accepted, Rejected | — |
| Accepted qty / Rejected qty | number | Partly accepted | — | Both above 0 and adding up to the offered quantity |
| Certificate / release note no. | text | Yes unless Rejected | — | Dispatch is released against it |
| Inspected on | date | Required if there is no call date | — | — |
| NCR severity | dropdown | When something is rejected | Minor, Major (default), Critical | — |
| Block rejected stock in store | dropdown | No | "Don't block (not in a store)" or a store | — |
| Why the agency rejected it / Remarks | text area | Required when something is rejected | — | Becomes the NCR description |

**Record result** asks for confirmation and needs quality:inspection_calls:edit. The result can never be changed afterwards. A rejected quantity raises an auto NCR (source customer_inspection), which can block the stock in the chosen store.

Once a result is recorded, the section shows Result, Accepted, Rejected, Certificate no., Inspected on, Recorded by, Remarks and a link to the NCR.

**Section "Agency certificate":** shows the attached file (click to open), or "No certificate file attached."

- **Attach certificate (PDF / scan)** accepts images or PDF under 15 MB, stored in SharePoint.
- It is allowed while the call is open, or once after the result if no file has been attached yet. It is not available on cancelled calls.

#### Statuses & workflow

Requested → Scheduled (date set) → Accepted / Partly accepted / Rejected (result recorded), or Cancelled from Requested or Scheduled. Re-offering material means raising a new call.

### RRV Final Inspections — /dashboard/quality/final-inspection

This tab holds the older free-text final inspections. The page title shows " Inspection". New final lots from Production output appear in Inspection Lots with type Final (production).

#### List view

- Columns: Inspection #, Item (code), Batch, Project, Qty Inspected, Date, Status (Pending, In Progress, Passed, Failed, Conditionally Passed), View.
- Filters: search (the server matches inspection number and item name only) and status.
- **Top button:** "+ New Inspection".

#### Create form — New Final Inspection (/dashboard/quality/final-inspection/new)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item Name | text | Yes | — | — |
| Item Code, Batch Number, Project Label | text | No | — | — |
| Qty Inspected / Accepted / Rejected | number | No | — | — |
| Inspection Plan | searchable dropdown | No | Final-type plans | Must exist |
| Inspection Date | date | No (default today) | — | — |
| Status | dropdown | — | Pending … Conditionally Passed | The server always saves a new record as Pending |
| Remarks | text area | No | — | — |
| Inspection Results | rows | — | Parameter, Method, Acceptance Criteria, Observed Value, Result (N/A/Pass/Fail) | Rows without a parameter are dropped |

- **Save Inspection** needs quality:final_inspection:create. The number format is INSP-FIN-year-0001. The inspector is the current user.
- **Cancel** returns to the list.

#### View page / Edit

This is the same editable form as the old in-process gate inspection.

- **Save Changes** needs quality:final_inspection:edit. A status change notifies Production.
- **Delete Inspection** needs delete permission on the tab. It is a soft delete.

### CAPA — /dashboard/quality/capa

#### List view

Title "CAPA (8D)", subtitle "Quality · Corrective & preventive actions".

| Column | What it shows |
|---|---|
| CAPA | CAPA number (prefix from Settings, default CAPA) |
| Title | One-line problem |
| Raised for | Trigger (Manual, Major / Critical NCR, Repeat defect, Customer complaint, Audit finding, Vendor trend), plus the NCR and complaint numbers |
| Severity | Pill |
| Owner | Responsible user, or "Not assigned" in amber |
| Open actions | Count, with "· overdue" in red |
| Status | Open, Root cause found, Actions in progress, Effectiveness check, Closed, Reopened |
| Opened | Created date |
| (action) | View |

- **Filters:**
  - Search (number, title, item).
  - Status (default "All not closed", or All statuses, or each status).
  - Trigger.
  - "Mine (owner / team / action)".
  - "Overdue only".
- **Top button:** "+ New CAPA".

#### Create form — New CAPA (/dashboard/quality/capa/new)

The note says Major/Critical NCRs, repeat defects, customer complaints, vendor rating drops and audit findings raise CAPAs automatically. The 8D steps are filled in on the CAPA itself. It needs quality:capa:create, and on the server a Quality engineer or head (capa edit authority).

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Title | text | Yes | — | — |
| Type | dropdown | Yes | Corrective, Preventive | — |
| Severity | dropdown | Yes (default Major) | Minor, Major, Critical | — |
| Item | searchable dropdown | No | Item Master | — |
| Defect code | dropdown | No | Active defect codes | — |
| Vendor | text | No | — | — |
| Audit reference | text | No | — | — |
| D2 — Problem description | text area | No | — | — |
| Linked NCRs | search + chips | No | Open NCRs, matched by number or item. It can be pre-filled from ?ncr=(signed ref). | Each NCR must exist |
| CAPA owner (champion) | searchable dropdown | No | Active users | The owner is added to the team as champion |
| Target date | date | No | — | — |

**Raise CAPA** saves it as Open and notifies the Quality heads and the owner.

#### View page (/dashboard/quality/capa/(signed ref))

**Header:** CAPA number, the subtitle "Quality · CAPA (8D) · (trigger)", severity pill, status pill, an "Overdue" pill when overdue, and "← Back".

- **Approval panel "D8 approval":** the central approval panel for the D8 verdict.
- **Step bar:** 1. Open, 2. Root cause found, 3. Actions in progress, 4. Effectiveness check, 5. Closed. Reopened goes back to step 1. It also shows "Reopened n×".

**Section (title = CAPA title):** Raised for, Type, Item, Vendor, Defect, Audit, Target date, Opened, and a link to the customer complaint.

**Section "D1 — Team"**

- The CAPA owner (champion) dropdown saves at once. A new owner is notified and added to the team.
- Members are shown as chips (name · role · department). The × removes a member (except the owner).
- Add member: person, Role (Member / Leader) and Department, then **Add to team**. Each person can be on the team only once, and new members are notified.
- Team changes are not possible on a closed CAPA.

**Section "D2 — Problem & linked NCRs"**

- Problem description (editable while Open, Reopened or Root cause found).
- The list of linked NCRs, each with its date, item, quantity, severity and status.
- "Link another NCR" plus a **Link NCR** button.

**Section "D3 — Containment":** a text area, editable until Actions in progress.

**Section "D4 — Root cause"**

- Method: Why-why (5 whys), Fishbone (6M), or Both.
- Why-why: Why 1…n inputs, starting with 3 and up to 7 ("+ Another why").
- Fishbone: Man, Machine, Method, Material, Measurement and Environment, with one cause per line.
- Root cause (verified).
- Buttons:
  - **Save D2–D4**
  - **Save & mark root cause found** (Open or Reopened). This requires all of: an owner; a team of 2 or more; a problem statement; containment; a method; at least 2 whys when why-why is used; fishbone causes when fishbone is used; and a root cause statement.

**Section "D5 / D7 — Actions (owner + due date) and D6 evidence"**

- Each action card shows "D5 ·" or "D7 · (prevention type):", the description, a status pill (open / done / cancelled, red when overdue), Owner, Due, Done, the cancel reason and the evidence.
- On an open action:
  - **Record evidence & mark done** asks for the D6 evidence (required) and a Document ref. The ref is required for preventive actions that update the inspection plan, drawing, procedure or FMEA. Allowed for the action owner or a Quality engineer/head.
  - **Cancel action** needs a reason.
- The add-action row is available in Open, Reopened, Root cause found and Actions in progress:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Kind | dropdown | Yes | D5 corrective, D7 prevention | — |
| Updates | dropdown | Yes for prevention | Update inspection plan, Update drawing / specification, Training, Update work instruction / procedure, Update FMEA / control plan, Other | — |
| Action | text | Yes | — | — |
| Owner | searchable dropdown | Yes | Active users | The owner is notified |
| Due date | date | Yes | — | Not in the past |

- "D7 — no prevention item needed because…" (Root cause found / Actions in progress) saves when you leave the field.
- "D6 — implementation summary" (Actions in progress / Effectiveness check) saves when you leave the field.
- **Start actions** (Root cause found) needs at least one corrective action.
- **All actions done → effectiveness check** (Actions in progress) needs no open actions, at least one corrective action done, and either a prevention item or a "not needed" reason. It sets the effectiveness due date to today + "CAPA effectiveness check after (days)" (default 90) and notifies the heads and the owner.
- Actions from before a reopen are listed under a collapsible "n action(s) from before the reopen".

**Section "D8 — Effectiveness & closure"** (Effectiveness check, Closed, or once a result exists)

- Shows Actions completed, Check due, Last result, Checked by and Remarks.
- If NCRs of the same item and defect were raised after the actions, they are listed in red as recurrences.
- In Effectiveness check:
  - Verification remarks field.
  - **Effective — close CAPA** — Quality head only, not before the due date. Remarks are required if there are recurrences.
  - **Not effective** — needs a reason. It reopens the CAPA, supersedes its actions and raises the report revision.
- These verdicts are recorded through the "CAPA effectiveness (D8)" approval workflow as a one-click decision by the Quality head.
- When Closed: **Reopen CAPA** (Quality head, reason required).

**Section "8D report"** (any status except Open / Reopened): the managed Word document "8D report". It is also the customer response for a complaint CAPA, and has a revision suffix -Rn after a reopen. Buttons: Save & Edit in Word / Download PDF.

#### Edit

Fields can be edited only in these statuses:

| Field | Editable in |
|---|---|
| Title, owner, target date | Any open status |
| Severity, problem, method, whys, fishbone, root cause | Open, Reopened, Root cause found |
| Containment | Up to Actions in progress |
| Implementation summary | Actions in progress, Effectiveness check |
| Prevention-not-needed reason | Root cause found, Actions in progress |

Closed CAPAs are never edited. There is no delete.

#### Statuses & workflow

| Status | Reached by | Who |
|---|---|---|
| Open | Manual raise or automatic trigger | — |
| Root cause found | Save & mark root cause found (D1–D4 complete) | Quality engineer / head |
| Actions in progress | Start actions (at least one corrective action) | Quality engineer / head |
| Effectiveness check | All actions done (D5/D6/D7 complete) | Quality engineer / head |
| Closed | Effective verdict on or after the due date | Quality head (approval workflow) |
| Reopened | Not effective verdict, or Reopen of a closed CAPA | Quality head |

Automatic triggers:

- **Major or critical NCR:** links to the open CAPA for the same item and defect code if there is one, otherwise raises a new CAPA.
- **Repeat defect:** the same defect code on the same item at least "CAPA trigger — same defect count" times (default 3) within "within (days)" (default 90) raises or links a repeat-defect CAPA.
- **Complaint:** a complaint investigation raises a CAPA.
- **Vendor:** a vendor rating below On watch, or a manual "Put on watch", raises one open vendor-trend CAPA per vendor.
- **Audit:** major or minor vendor audit findings raise a CAPA.

### Complaints — /dashboard/quality/complaints

#### List view

Title "Customer Complaints". KPI tiles from /quality/complaints/stats (rejected complaints are left out):

- **Open:** the count of open complaints.
- **This year:** complaints dated this year.
- **Repeats:** complaints flagged as a repeat.
- **Avg. response:** average days from complaint to response sent.
- **Total cost:** sum of the four cost fields.

| Column | What it shows |
|---|---|
| Complaint | Number (prefix from Settings, default COMP), with "· repeat" in red |
| Customer | Customer name |
| Item / serial-batch | Item, then serial or batch |
| Severity | Pill |
| NCR / CAPA | Linked numbers |
| Response | "n days" to response, or "n days open" |
| Cost | Total cost |
| Status | Logged, Under investigation, Response sent, Customer accepted, Closed, Rejected (not valid) |
| Date | Complaint date |
| (action) | View |

- **Filters:** search (number, customer, item, serial / batch), status (default "All open", or All statuses, or each status) and severity.
- **Top button:** "+ Log complaint".

#### Create form — Log Customer Complaint (/dashboard/quality/complaints/new)

It needs quality:complaints:create.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Source | dropdown | Yes (default Email / letter) | Service ticket, Email / letter, Customer inspection report, Phone call, Site visit, Other | — |
| Reference (Service ticket no. when the source is a service ticket) | text | No | — | — |
| Complaint date | date | Yes (default today) | — | Not in the future |
| Machine / order (ERP) | searchable dropdown | No | ERP projects | Fills in the customer |
| Customer | text | Yes (or taken from the machine) | — | — |
| Contact person | text | No | — | — |
| Item (Item Master) | searchable dropdown | No | Item Master | — |
| …or item name | text | No | Shown when no item is picked | — |
| Serial no., Batch / heat no. | text | No | — | — |
| Qty affected | number | No | — | Above 0 |
| Category | dropdown | No | Master list "Complaint categories" (Product failure, Dimensional, Documentation, Delivery / packing, Other) | Must be active |
| Defect code | dropdown | No | Active defect codes | — |
| Severity | dropdown | Yes (default Minor) | Minor, Major, Critical | — |
| Description (as the customer reported it) | text area | Yes | — | — |
| Photos | file (multiple images) | No | — | Uploaded after saving. A failed upload does not stop the complaint being logged. |

**Log complaint** saves it as Logged and checks whether it is a repeat. A repeat is the same customer and item within "Complaint counts as repeat within (days)" (default 365). The Quality heads are notified.

#### View page (/dashboard/quality/complaints/(signed ref))

**Header:** complaint number, severity pill, status pill, a "Repeat" pill, and "← Back". The "Close / reject approval" panel is shown, followed by the step bar (hidden when Rejected): Logged → Under investigation → Response sent → Customer accepted → Closed.

**Section "Complaint":**

- Shows Customer, Machine / order, Contact, Source, Item, Serial / batch, Qty affected, Category, Defect, Logged, Owner, Response time, a link to the earlier complaint it repeats, Description, "Rejected because" and photo thumbnails.
- While live (not Closed or Rejected), there is a photo upload with an **Upload photos** button.
- While Logged:
  - The Complaint owner dropdown.
  - **Start investigation (raise NCR + CAPA)** needs a Quality engineer/head and an item on the complaint. It raises an NCR (source complaint), raises or links a complaint CAPA (the owner becomes the CAPA owner) and moves the complaint to Under investigation.
  - **Not a valid complaint** needs a reason, which is shared with the customer. Quality head only, through the approval workflow.

**Section "Investigation":** links to the NCR and to the CAPA (with its status and "effective"). The note says the 8D report for the customer is generated on the CAPA once its root cause is found.

**Section "Traceability & containment"** (by serial / batch):

- "Same batch still in stock": Store, Free, Quality and Blocked quantities.
- "Same batch already delivered / issued": Issue, Type, Date, Qty, To.
- "Inspection history of the batch": Lot, Inspection, Source, Vendor, Decision, Date.
- Machines, NCRs and third-party calls for the batch.
- "Other complaints on this batch".
- While live: a "Containment done (units held / sorted / replaced)" text area with **Save**.

**Section "Customer response"** (from Under investigation):

- The response text is editable while Under investigation.
- **Response sent** needs a Quality engineer/head and the text. The CAPA must have reached Root cause found or later.
- While Response sent:
  - "Customer acceptance (email / letter ref., name, date)" field.
  - **Customer accepted** — the reference is required. The status becomes Customer accepted.
  - **Not satisfied** — the remarks are required. The complaint goes back to Under investigation.

**Section "Cost of the complaint"** (not shown when Rejected): replacement, travel, rework and other costs (₹, not negative). **Save costs** is available while live. The total is shown.

**Section "Closure"** (Customer accepted / Closed):

- If the CAPA is not yet closed effective, an amber warning is shown.
- Resolution notes field and **Close complaint** button. Quality head only, through the approval workflow. The CAPA must be Closed with result Effective.

#### Edit

- Editable fields: source and reference, customer, project, contact, item, serial and batch, quantity, category, defect, description, severity, date, owner, containment, resolution, remarks and costs. They can be changed while the complaint is not Closed or Rejected.
- Customer, project, item, complaint date and source are locked once the investigation has started.

#### Statuses & workflow

Logged → Under investigation (Start investigation) → Response sent → Customer accepted → Closed.

- Not satisfied returns the complaint to Under investigation.
- Rejected (not valid) is only possible from Logged.
- Close and Reject are Quality-head one-click decisions recorded in the "Customer complaint close / reject" approval workflow.

### Supplier Quality — /dashboard/quality/supplier-quality

**Header:** "Supplier Quality" with the top button "+ Add vendor for an item". A note explains the monthly score:

- quality weight % × (accepted ÷ received)
- plus delivery weight % × (GRNs received on or before the PO expected date)
- plus NCR weight % × (100 − 5 / 15 / 40 points per minor / major / critical NCR)
- Below the On-watch limit the vendor goes On watch (tightened sampling and a vendor CAPA). Below the Blocked limit it is Blocked after a Partner approves.

There are four tab buttons.

#### Vendors tab

- Columns: Vendor, Items, Trial, Approved, On watch (amber), Blocked (red), Waiting for Partner, Last score (period), Vendor CAPA (link).
- Clicking a row opens the Approved vendor list tab filtered to that vendor.
- Empty state: vendors are added automatically when they first supply an inspection-controlled item.

#### Approved vendor list tab

- Filters: search (vendor or item), status (Trial, Approved, On watch, Blocked) and "Waiting for a Partner".
- Columns: Vendor, Item, Status, Sampling (Normal / Tightened / Reduced, plus skip-lot), Accepted in a row, Last score, Valid until (red with "re-evaluate" when expired), Pending (action awaiting a Partner), View.

#### Monthly rating tab

- A month picker (defaults to the previous month).
- **Compute / refresh (period)** is Quality head only. It recalculates the scorecards and escalates vendors. The note says the previous month is rated automatically on the first run of a new month.
- Columns: Vendor, Period, Lots, Received, Accepted, Quality, NCRs (minor / major / critical), NCR score, On-time (on time / total), Delivery, Score, Band (Approved / On watch / Blocked).

#### Vendor audits tab

Schedule a vendor audit (needs supplier_quality:create and a Quality engineer/head):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Vendor | text | Yes | — | — |
| Planned date | date | Yes | — | — |
| Auditor | searchable dropdown | No | Users | The auditor is notified |
| Scope | text | No | — | — |

- Table: Audit (number, prefix VA), Vendor, Planned, Auditor, Status (and audit date), Score, Result, Findings, CAPA link, and "Record result" (planned audits only).
- The "Record audit result" form:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Audit date | date | Yes | — | — |
| Score (0–100) | number | No | — | 0 to 100 |
| Result | dropdown | Yes | Satisfactory, Conditional, Unsatisfactory | — |
| Findings | text area | No | One per line, starting "major:", "minor:" or "observation:" (lines without a prefix count as observations) | Major or minor findings raise a CAPA (trigger audit) |
| Remarks | text | No | — | — |

**Save result** marks the audit completed. A completed audit does not change.

#### Create form — Add Vendor for an Item (/dashboard/quality/supplier-quality/new)

The note says a vendor starts on Trial, and inspection-controlled vendors are added on their first receipt and approved by their first article. It needs supplier_quality:create and a Quality engineer/head.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item | searchable dropdown | Yes | Item Master | — |
| Vendor | text | Yes | Exactly as on the purchase orders | Must not already be on the list for the item |
| Remarks | text | No | — | — |

**Add to list** creates the entry in status Trial.

#### View page (/dashboard/quality/supplier-quality/(signed ref))

**Header:** "(vendor) — (item)", the subtitle "Quality · Approved vendor list", status pill and "← Back".

**Section "(Block / Unblock) waiting for a Partner"** (when a request is pending):

- Shows the Reason and Requested (by and date).
- New requests are decided in the approval panel.
- Older (legacy) requests show **Approve (block / unblock)** and **Reject** buttons, to Partners only.

**Approval panel "Approval workflow"**.

**Section "Approval":** Item, Status reason, Approved (date and by), First article, Valid until (with "re-evaluation due"), Last rating.

| Button | When it appears | What it does |
|---|---|---|
| Approve vendor | Status Trial | Asks for the basis of approval. Quality head only. Not allowed for inspection-controlled items whose first article is not released (they are approved by their FAI). Sets Approved and valid until today + "Vendor approval valid for (months)". Recorded in the "Vendor approval (Trial → Approved)" workflow. |
| Put on watch | Trial or Approved | Reason required, Quality head. Status becomes On watch (tightened sampling) and a vendor CAPA is raised. |
| Take off watch | On watch | Reason required, Quality head. The vendor CAPA must be closed. Status becomes Approved. |
| Request block | Not Blocked and nothing pending | Reason required, Quality head. Submits to the "Vendor block / unblock" workflow (Partner). |
| Request unblock | Blocked and nothing pending | Reason required, Quality head. On approval the vendor returns to On watch. |

**Section "Sampling (ISO 2859-1 switching)":** the current state (plus skip-lot active), accepted in a row, and the recent lots (✓ / ✗, oldest to newest).

**Section "History":** status events with date, event, from → to, reason and user (or System).

#### Statuses & workflow

Trial → Approved (approved FAI, or Approve vendor) → On watch (rating below the limit, or manual) → Blocked (Partner-approved request). An unblock returns the vendor to On watch.

A monthly rating back above the limit returns On-watch vendors to Approved when no vendor CAPA is open.

Sampling switching on each decided vendor lot:

| Change | When |
|---|---|
| Normal → Tightened | 2 of the last 5 lots not accepted |
| Tightened → Normal | "Tightened → normal after" lots accepted in a row (not while On watch or Blocked) |
| Normal → Reduced | Approved vendor with "Reduced sampling after" lots accepted in a row |
| Reduced → skip-lot | "Skip-lot after" lots accepted in a row and score at or above the skip-lot minimum. On skip-lot, 1 lot in "Skip-lot frequency" is fully inspected; the others check only critical characteristics. |
| Any rejection on Reduced | Back to Normal, and skip-lot ends |

On watch and Blocked vendors always get tightened sampling.

### Standards — /dashboard/quality/standards

#### List view

- Columns: Code, Title, Category, Effective Date, Status (Active / Draft / Obsolete), View.
- Search (code, title, category) runs in the browser. The status filter runs on the server.
- **Top button:** "+ New Standard".

#### Create form — New Standard (/dashboard/quality/standards/new)

It needs quality:standards:create.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Standard Code | text | Yes | e.g. QMS-001 | Unique. A code used by a deleted standard cannot be reused (e.g. use code-R1). |
| Title | text | Yes | — | — |
| Category | text | No | — | — |
| Effective Date | date | No | — | — |
| Status | dropdown | Yes (default Draft) | Draft, Active, Obsolete | — |
| Description | text area | No | — | — |

Buttons: **Save Standard** / Cancel.

#### View page / Edit

- The same fields are editable. **Save Changes** needs quality:standards:edit, and the code must stay unique.
- **Delete Standard** appears when the user may delete (owner rule). The server soft-deletes, although the dialog says "permanently".
- There is no status workflow; the status is set by hand.

### Documents — /dashboard/quality/documents

Title "Documents" — "SOPs, specifications, certificates, and standard references."

#### Create form — Upload Document

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Doc Type | dropdown | Yes (default SOP) | SOP, Specification, Certificate, Standard Reference, Other | — |
| Title | text | Yes | — | — |
| Version | text | No | e.g. v1.0 | — |
| Linked Standard (optional) | searchable dropdown | No | Active standards | — |
| Description | text | No | — | — |
| File(s) | file (multiple) | Yes | — | Stored in SharePoint (Quality-media). Fails if SharePoint is not configured. |

**Upload** creates one document record per file. Only Quality app access is needed.

#### List view

- Filters: doc type and linked standard.
- Columns: Title, Type pill, Version, File, Size, Uploaded By, Uploaded On.
- Actions: **View** (opens the file) and **Delete** (shown when the user may delete; confirmation). Delete removes the SharePoint file and soft-deletes the record.

### Reports — /dashboard/quality/reports

Title "Quality Reports". There is one section, "Defect Pareto". It rebuilds whenever a filter changes and only covers records in the user's data scope.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Count | dropdown | Yes | NCRs; Failed characteristics on lots | — |
| From | date | No (default 1 Jan this year) | — | Must not be after To |
| To | date | No | — | — |
| Item | searchable dropdown | No | All items / Item Master | — |
| Vendor | text | No | — | Exact match, case ignored |
| NCR source / Inspection type | dropdown | No | NCR sources (for NCRs) or inspection types (for lot results) | — |

A line shows the total occurrences and explains that highlighted rows are the "vital few" (the defect codes making up the first 80%).

| Column | What it shows |
|---|---|
| Defect code | Code — name |
| Category | Defect category |
| Count | Occurrences (one per NCR, or one per failed characteristic) |
| (bar) | Bar relative to the largest count; orange for the vital few |
| % | Share of the total |
| Cumulative % | Running total |
| Quantity | NCR quantity, or defective units |
| Cost | For NCRs: material + rework + other cost |

### Settings — /dashboard/quality/settings

Title "Quality Settings". If the user cannot edit, an amber line says "Read-only — only a Quality head or an admin can change Quality settings." A note says that who approves NCR dispositions (including the scrap value that needs a Partner), inspection plans, vendor blocks, CAPA D8 and complaint closure is set in Organization › Approval Workflows, not here.

The page has these parts (detailed in section 4):

- one section per setting group (Numbering, Thresholds, KPI targets, Sampling defaults), each field with its help text
- **Save settings** (editors only)
- "Master lists"
- "Quality roles"

A success dialog confirms a save ("The change is recorded in the audit log"). Saving validates every value first, so one bad value means nothing is saved.

## 4. Settings / Masters

### Quality Settings — values (Quality → Settings)

Only users with quality:settings:edit (Quality head) or an admin can change these. Every change is audit-logged.

| Group | Setting | Default | What it controls |
|---|---|---|---|
| Numbering | Inspection lot number prefix | IL | Lots numbered prefix-year-0001 |
| Numbering | NCR number prefix | NCR | NCR numbering |
| Numbering | First article (FAI) number prefix | FAI | FAI numbering |
| Numbering | Inspection call number prefix | IC | Inspection call numbering |
| Numbering | CAPA number prefix | CAPA | CAPA numbering |
| Numbering | Customer complaint number prefix | COMP | Complaint numbering |
| Numbering | Vendor audit number prefix | VA | Vendor audit numbering |
| Thresholds | Lot waiting alert after (days) | 2 (min 1) | Age at which open lots show red, count as "waiting too long" and trigger a daily reminder |
| Thresholds | Inspection call reminder before (days) | 2 | Days before a scheduled call that engineers get a Teams + bell reminder |
| Thresholds | Gauge due alert before (days) | 15 | Reserved for Phase 4 (calibration) |
| Thresholds | Vendor "On watch" below score | 90 | Monthly score below this puts the vendor On watch |
| Thresholds | Vendor "Blocked" below score | 75 | Below this a block is requested (Partner). Must be lower than the On-watch score. |
| Thresholds | Vendor rating weight — quality / delivery / NCR severity (%) | 60 / 30 / 10 | Score weights; must add up to 100 |
| Thresholds | CAPA trigger — same defect count / within (days) | 3 / 90 | Repeat-defect CAPA trigger |
| Thresholds | CAPA effectiveness check after (days) | 90 | D8 due date after the actions are completed |
| Thresholds | Complaint counts as repeat within (days) | 365 | Repeat complaint flag |
| Thresholds | Vendor approval valid for (months) | 36 | AVL "valid until" date |
| KPI targets | Incoming rejection % (max) | 2.0 | Target value (stored) |
| KPI targets | Internal rejection % (max) | 1.0 | Target value |
| KPI targets | First-pass yield % (min) | 98 | Target value |
| KPI targets | Customer complaints per month (max) | 0 | Target value |
| KPI targets | Cost of poor quality per month (₹, max) | 0 | Target value |
| KPI targets | NCR closure time (days, max) | 30 | Target value |
| KPI targets | CAPA on-time % (min) | 90 | Target value |
| KPI targets | Calibration compliance % (min) | 100 | Target value |
| KPI targets | Third-party first-pass % (min) | 95 | Target value |
| Sampling defaults | Reduced sampling after (accepted lots in a row) | 10 | Normal → reduced switching |
| Sampling defaults | Tightened → normal after (accepted lots in a row) | 5 | Tightened → normal switching |
| Sampling defaults | Skip-lot after (accepted lots in a row) | 20 | Skip-lot qualification |
| Sampling defaults | Skip-lot minimum vendor score | 95 | Skip-lot qualification |
| Sampling defaults | Skip-lot: fully inspect 1 lot in | 4 | Skip-lot frequency |
| Sampling defaults | First article sample (pieces) | 5 | FAI sample when the item has no own FAI plan |
| Sampling defaults | Default sampling | AQL table | Pre-fills a new plan |
| Sampling defaults | Default AQL | 1.0 | Pre-fills a new plan |
| Sampling defaults | Default inspection level | General II | Pre-fills a new plan |
| Sampling defaults | Default switching state | Normal | Sampling state of non-vendor lots |

Prefixes must be 1–10 letters or digits. The KPI targets are stored for reporting; no screen in this module uses them yet.

### Master lists (Quality → Settings → Master lists)

Values are never deleted; they are retired so old records keep their meaning. Adding, retiring and reactivating needs settings edit authority.

| List | Seed values | Used by |
|---|---|---|
| NCR sources | Incoming inspection, Job work inspection, In-process inspection, Final inspection, Customer / third-party inspection, Customer complaint, Audit, Internal finding | Raise NCR source dropdown |
| Complaint categories | Product failure, Dimensional, Documentation, Delivery / packing, Other | Complaint category |
| Audit types | Internal audit, Vendor audit, Customer audit, Certification audit | Reserved for Phase 4 audits |
| Inspection agencies | RITES, RDSO, Customer, Other | Inspection calls and contract requirements |

### Quality roles (Quality → Settings → Quality roles)

- The page lists active users with Quality access, with Admin, Partner and role pills (or "No Quality role").
- Admins only see a form: User, Role and **Grant role**. It applies the matching role (or the code-defined grants as extra permissions), reports how many permissions were added, and writes an audit log entry.

### Quality Masters (Quality → Masters)

- **Inspection characteristics:** what is checked (measured or pass/fail, unit, method, gauge type, default class). These are the building blocks of plans.
- **Defect codes:** required on every failed result. They drive NCR defects, repeat-defect CAPAs and the Pareto.
- **Disposition codes:** the "acts as" type decides the approval stages and the stock movement when the NCR action is done.
- **Sampling tables:** the ISO 2859-1 code letters and n/Ac/Re plans for normal, tightened and reduced inspection. They are seeded and read-only, with a calculator.

### Other settings that affect Quality (outside this module)

- **Organization › Approval Workflows:** NCR disposition (including the scrap limit for the Partner stage), Inspection plan, Vendor block / unblock, Vendor approval, CAPA effectiveness (D8), Customer complaint close / reject. Stage reminders and escalation come from the approval engine.
- **Store Item Master flags:** "inspection on receipt" (makes an item inspection-controlled) and "test certificate required".
- **Company Info → Partners:** who counts as a Partner approver.

## 5. Permissions

Every Quality route needs Quality app access. Tabs show according to view permission (quality:(subtab):view). Records are filtered by data scope:

| Record | Owner (data scope) | Assigned (data scope) |
|---|---|---|
| NCR | Raised by | Disposition proposer |
| Inspection lot | Creator | Inspector, results recorder |
| CAPA | Creator | Owner, team members, action owners |
| Complaint | Received by | Owner |
| Inspection call | Creator | Result recorder |
| FAI | Creator | Inspector of its lot |
| Approved vendor | Creator | Requester / approver |
| Vendor audit | Creator | Auditor |
| Quality document | Uploader | — |

Permission keys (module "quality"):

| Sub-tab key | Actions available |
|---|---|
| dashboard | view |
| project_work | view, edit |
| my_inspections | view, edit |
| inspection_lots | view, create, edit, delete, approve, print |
| ncr | view, create, edit, delete, approve, reject, export, print |
| inspection_plans | view, create, edit, delete, submit, approve, cancel |
| masters | view, create, edit |
| in_process_inspection | view, create, edit, delete, approve |
| final_inspection | view, create, edit, delete, approve, print |
| first_article | view, create, edit, approve, print |
| inspection_calls | view, create, edit, approve, print |
| standards | view, create, edit, delete |
| capa | view, create, edit, approve |
| complaints | view, create, edit, approve |
| supplier_quality | view, create, edit, approve |
| documents | view, create, edit, delete |
| reports | view, export, print |
| settings | view, edit |

**Authority grants** must be given explicitly, through a role or an admin. Admins always pass.

| Grant | Authority |
|---|---|
| quality:inspection_lots:approve | Make usage decisions |
| quality:ncr:edit | Quality engineer authority: propose / record action / verify NCRs, Quality engineer approval stage |
| quality:ncr:approve | Quality head: close / cancel NCRs, accept with deviation, Quality head approval stage |
| quality:first_article:approve | Approve / reject FAIs |
| quality:inspection_calls:edit | Record third-party results (releases dispatch) |
| quality:inspection_plans:approve | Approve plans, make obsolete |
| quality:capa:edit | Work 8D steps, raise CAPAs |
| quality:capa:approve | D8 verdict, close and reopen CAPAs |
| quality:complaints:approve | Close or reject complaints |
| quality:supplier_quality:approve | Approve vendors, watch / release, request block / unblock, re-run ratings |
| quality:settings:edit | Change settings and master lists |
| quality:inspection_calls:approve | Change contract third-party requirements |

Quality roles (permission sets applied in Settings):

| Role | Main grants |
|---|---|
| Quality inspector | dashboard view; my_inspections and inspection_lots view/edit; ncr view/create; plans and masters view; in-process, final and first-article view/edit; inspection calls, CAPA, complaints and supplier quality view |
| Quality engineer | Inspector + inspection_lots create/approve; ncr edit; plans create/edit/submit/cancel; masters create/edit; settings view; CAPA view/create/edit; reports, standards and documents view; first_article create/approve; inspection calls create/edit; complaints and supplier quality view/create/edit |
| Quality head | Engineer + ncr approve; plans approve; settings edit; CAPA approve; complaints approve; supplier_quality approve; standards and documents create/edit; project_work view; inspection calls approve |
| Calibration in-charge | dashboard, masters and reports view |

Other authorities:

- **Design** stage approver: holds design:reviews:approve.
- **Purchase** stage approver: the "purchase head" flag (fallback: Purchase module users).
- **Partner:** set only in Company Info → Partners. Approves scrap above the limit and vendor block / unblock.
- **Delete** buttons (plan drafts, standards, documents, old inspections, manual NCRs) follow the app-wide delete rule (canDelete / ensure_can_delete).
- **Photos:** only the uploader or an admin can remove a lot photo.
- **Word / PDF records:** opening one needs view on the source tab (inspection_lots, ncr, capa); editing in Word needs edit.

## 6. Documents, Notifications & Integrations

### Generated documents (managed Word, PDF secondary)

Each document has "Save & Edit in Word" (creates the letterhead .docx once, opens it in Word Online, and keeps version history and upload in the managed document panel) and "Download PDF" (renders the Word document of record if one exists, otherwise a fresh PDF from system data).

| Document | Number | Where | When available | Content |
|---|---|---|---|---|
| Inspection report | Lot number | Lot view → Documents | Lot decided | Lot facts, results per characteristic (spec, sample, observed, result, defect/gauge), usage decision, NCRs |
| Test certificate | TC-(lot number) | Lot view → Documents | Lot decided and accepted quantity above 0 | Certifies the accepted quantity with the test results; goes to the customer |
| Deviation approval | DEV-(NCR number) | NCR view | Use as is / Repair disposition approved | Non-conformance, disposition justification, approving authorities |
| 8D report | CAPA number (-Rn after a reopen) | CAPA view | From Root cause found onwards | D1 team, D2 problem and NCRs, D3 containment, D4 why-why / fishbone / root cause, D5/D6 corrective actions and evidence, D7 prevention, D8 effectiveness |

### Notifications

Bell notifications unless marked Teams. Teams is used only for reminders and critical items.

| Event | Recipients | Channel |
|---|---|---|
| New inspection lot | Assigned inspector; otherwise every user with inspection_lots:edit (or a Quality app broadcast) | Bell |
| New lot with no approved plan ("Inspection Plan Needed") | Quality engineers | Bell + Teams |
| Lot assigned | Assignee | Bell |
| Lot waiting longer than the setting (daily job) | Quality engineers (or broadcast) | Bell + Teams |
| NCR raised | Quality engineers | Bell |
| Critical NCR ("Critical NCR — Action Needed") | Quality engineers, Quality heads, Partners | Bell + Teams |
| NCR disposition approval steps | Stage approvers (approval engine; reminders / escalation from the engine) | Engine |
| Legacy disposition approved / rejected | Proposer | Bell |
| FAI approved / rejected | Quality engineers | Bell |
| Inspection call raised / scheduled | Quality engineers | Bell |
| Inspection call coming up (daily job) | Quality engineers | Bell + Teams |
| Gate passed / failed | WO supervisor and creator | Bell |
| CAPA raised, actions completed, closed, not effective | Quality heads, CAPA owner (and team on close / reopen) | Bell |
| CAPA assigned / added to team / action assigned | That user | Bell |
| CAPA action overdue; D8 effectiveness due (daily job) | Action owner / CAPA owner + Quality heads | Bell + Teams |
| Customer complaint received | Quality heads | Bell |
| Vendor rating below limit | Quality heads + Purchase contacts | Bell |
| Vendor block / unblock approved or rejected | Quality heads, Purchase contacts, requester | Bell |
| Vendor audit assigned | Auditor | Bell |

The daily Quality job also rates the previous month's vendors once at the start of a new month, which may escalate vendors.

### Links to other modules

- **Store / P2P GRN:**
  - A GRN line of an item flagged "inspection on receipt" must name a receiving store. The quantity is posted to Quality stock at the PO rate and an incoming lot (or a first-article lot) opens.
  - The lot decision writes the accepted/rejected split back onto the GRN line.
- **P2P purchase orders:** PO and RFQ-to-PO creation is refused for items where the vendor is Blocked on the approved vendor list.
- **P2P vendor returns:** a Return-to-vendor NCR action records a Return to Vendor against the GRN line.
- **Store material returns:** material coming back from a job-work vendor (inspection-controlled item or one with a job-work plan) goes to Quality stock under a Job work lot.
- **Store stock:** "clear quarantine" cannot release Blocked stock held by open NCRs.
- **Store dispatch issues:** a "Dispatch to customer" issue runs the rule 8 dispatch check (decided final inspection for the batch; third-party certificate when the ERP contract requires it).
- **Production:**
  - Gated routing steps raise In-process lots and are held until they are decided.
  - Receive Output raises a Final (or first-article) lot with the finished goods in Quality stock.
  - Work order release is refused while an in-house FAI from another WO is open.
  - A failed gate on an RRV build raises a rework order linked to the NCR.
  - Status changes on old gate inspections notify the supervisor.
- **Design:** the FAI captures the item's released drawing revisions (GA / part / assembly drawings). A new released revision triggers a new FAI.
- **ERP machines / orders (projects):** the third-party inspection flag and agency are stored on the project. They are used by inspection calls, dispatch checks, complaints and traceability.
- **Organization › Approval Workflows:** the central approval engine for NCR dispositions, plans, vendor approval / block, CAPA D8 and complaint close / reject (ApprovalPanel on each record).
- **SharePoint:** lot photos, complaint photos, inspection call certificates, quality documents and managed Word documents.
