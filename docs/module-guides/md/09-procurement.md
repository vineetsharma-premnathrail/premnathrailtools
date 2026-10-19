# Procurement (P2P) Module

The Procurement module (internally "P2P", procure-to-pay) is where any department asks the company to buy something and where the Purchase team turns that request into a purchase order. A requester raises a **Purchase Requisition (PR)** for items picked from the Store Item Master; it goes through the "Purchase requisition" approval workflow; on final approval the system checks store stock line by line, so items already in store are issued instead of bought. Lines that must be bought go to an **RFQ** (Request for Quotation) where the buyer attaches up to four vendor quotations (L1 = lowest to L4) picked from the shared **Vendor** master. From the finished RFQ the buyer creates a **Purchase Order (PO)**, prices every line, generates the PO as a managed Word document on the company letterhead and sends it for approval (the "Purchase order" workflow, by default ending with any one Partner). Approved POs are then received in Store (GRN and inspection), which moves the PO and the requisition to received / closed. In the company's core business flow (Customer → BD → R&D → Design/EHP → BOM → **Store/Purchase** → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) this module is the **Purchase** half of the Store/Purchase step: it takes material needs from Design/BOM, Production, Maintenance, Service and Store, buys what Store cannot supply, and hands vendors and PO values to Finance for invoice matching.

## 1. Navigation Tabs

The module sub-nav sits at the top of every Procurement page (with the guided-tour button and the notification bell on the right). Tabs are filtered by the user's access; the table shows them in screen order.

| Tab | Route | What it opens |
|---|---|---|
| Purchase Requisitions | /dashboard/p2p | The requisition list ("My Requisitions") and, for approvers, the "Approvals" view. Visible to everyone with Procurement access. |
| Vendors | /dashboard/p2p/vendors | The shared vendor master (with Finance). Visible to the Purchase team, Accounts (Finance) users and admins. |
| R.F.Q | /dashboard/p2p/rfq | Requisitions waiting for an RFQ and the list of RFQs. Purchase team only. |
| Purchase Orders | /dashboard/p2p/purchase-orders | One tab with three views: Create PO, Approvals, Tracking. Visible to the Purchase team and to PO approvers. |
| M.I.S Report | /dashboard/p2p/mis | Procurement KPIs, charts, pending-approver table and Excel export. Purchase team only (in the nav). |
| Settings | /dashboard/p2p/settings | Company terms and conditions, notification rules, and a read-only "Who approves" card. Visible to everyone with Procurement access. |

Notes:
- "Purchase team" means a user who has the **purchase** app. Requesters normally hold only the **p2p** app.
- Each tab is also subject to the Permission Matrix tab check (the tab is hidden if the user has no access to that sub-tab).
- Old links are kept as redirects: /dashboard/p2p/approval opens Purchase Requisitions with the Approvals view; /dashboard/p2p/po-approval opens Purchase Orders › Approvals; /dashboard/p2p/po-tracking opens Purchase Orders › Tracking; /dashboard/p2p/project-work forwards to the company-wide Ongoing Projects page (/dashboard/ongoing-projects, keeping an opened project id).

## 2. Dashboard

The Procurement module has no separate dashboard page. Its landing page (/dashboard/p2p) is the Purchase Requisitions list (Section 3, first screen). The module's analytics dashboard is the **M.I.S Report** tab (/dashboard/p2p/mis), described here widget by widget.

All M.I.S figures come from GET /p2p/mis/summary. Only requisitions inside the viewer's Procurement data scope (plus the ones they approve) are counted. Opening the report needs the Purchase team app, or the Purchase Head / Director / Partner flag, or admin, AND "View" on Procurement › M.I.S Report.

### Header and period selector

- Shows "Procurement Module", the title "M.I.S Report" and the date range of the loaded period (for example "06 Oct 2026 – 12 Oct 2026").
- Period tabs: **Daily** (today), **Weekly** (Monday to Sunday of the current week, the default), **Monthly** (1st to last day of the current month), **Yearly** (1 Jan to 31 Dec of the current year), **Custom**.
- Custom shows **From** and **To** date pickers. Nothing loads until both are picked; if From is after To the page shows "The From date must be on or before the To date."

**Actions:**
- Click a period tab: reloads every widget for that period.
- **Export Excel** (shown only with the M.I.S "Export" permission; disabled while loading or with no data): downloads P2P_MIS_[period]_[from]_to_[to].xlsx with the sheets Summary (KPIs), PR Details (one row per requisition created in the period, with approvers and a link), PR Items, PO Approval Details, Trend (with a chart), Category Breakdown (with a bar chart) and Approver Pending.

### KPI tiles

| Tile | How it is computed |
|---|---|
| PRs Created | Requisitions whose creation date falls in the period. |
| PRs Approved | Requisitions whose final PR approval date falls in the period and that are not now rejected or cancelled. |
| PRs Rejected | Requisitions now in status Rejected whose last update falls in the period. |
| PRs Pending Approval | All requisitions currently in status Submitted (not limited to the period). |
| POs Raised | Requisitions whose PO date falls in the period. |
| POs Approved | Requisitions in status PO Approved whose last PO approval timestamp falls in the period. |
| PO Pending Approval | All requisitions currently in status PO Raised (not limited to the period). |

**Actions:** none (display only).

### Trend — Created vs Approved vs PO Raised

A grouped bar chart with one bucket per day of the period (one bucket per month for Yearly). Three bars per bucket: Created (requisition creation date), Approved (final PR approval date) and PO Raised (PO date).

**Actions:** hover a bar for its value; click a legend entry to hide or show a series.

### PRs by Category

A horizontal bar chart counting requisitions created in the period per category (Market Items, Pneumatic & Hydraulic, Raw Material, Electrical, Hardware & Consumables, Job Work, Others), largest first. Shows "No PRs created in this period." when empty.

**Actions:** hover for the count.

### Pending Approval — By Approver

A table with columns **Approver**, **Role** and **Pending** (count), sorted by the highest count. It counts every requisition waiting at PR approval (Submitted) and every PO waiting at PO approval (PO Raised): for approvals running in the central approval engine, each person the current stage waits on, with the stage name as the role; for older in-flight items, the named approver rows or the holders of the pending role flags (Purchase Head, Director, Partner). Shows "Nothing pending right now." when empty.

**Actions:** none.

## 3. Screens

### Purchase Requisitions — /dashboard/p2p

The landing page of the module. Requires the **p2p** app. Header: "Procurement Module", title "Purchase Requisitions" and the note "Raise requisitions and approve them here — approvers are set in Organization › Approval Workflows."

#### List view

Top buttons (right of the title):

| Button | When shown | What it does |
|---|---|---|
| Export | "Export" on Procurement › Purchase Requisitions | Opens the export dialog. Lists up to 500 requisitions the user can see (label "PR number — project", sub-line status and requester). Export either ticked requisitions or all visible ones within a From–To request-date range. Downloads purchase_requisitions.xlsx with one row per item line (PR No., Request Date, Status, Category, Project Type, Project, Department, Requested By, Priority, Required By, Requirement Type, Item Code, Item, Make, Part Code, Unit, Quantity, Project / Inhouse, Item Category, Ship To, Line Status, PO No., PO Value, Remarks). |
| Import | "Create" on Purchase Requisitions | Opens the import dialog with a downloadable CSV template (purchase_requisition_import_template.csv). One row per item; rows with the same PR Ref become one requisition. Each created requisition goes for approval exactly like one raised by hand. The result shows "Requisitions created: N (numbers)" and a per-row error list. |
| + New Purchase Requisition | "Create" on Purchase Requisitions | Opens /dashboard/p2p/new. |

Import columns (backend): PR Ref (required), Category Code (required; MKT, PNH, RAW, ELE, HWC, JOB or OTH), Project Type (required; existing or new), Project (required), Required By, Requirement Type (must be one of the fixed list), Priority (low / medium / high, default medium), Remarks, Item Code (required; must be an Item Master code), Make, Quantity (required, more than 0), Project / Inhouse (required; Project or Inhouse), Ship To. Note: the dialog's intro text says "Item Name" is required, but the backend actually identifies the item by **Item Code**.

View switch (shown only to PR approvers — admins, users named on older requisitions, or anyone who has an approval step in the "Purchase requisition" workflow): **My Requisitions** | **Approvals**. Opening the page with ?view=approvals starts on Approvals.

Filters (My Requisitions view only):
- **All categories** dropdown — built from the categories present in the loaded list.
- **All buyers** dropdown — the assigned buyers present in the list, plus "No buyer assigned".
- **Clear filters** link appears when a filter is set.

Columns:

| Column | What it shows |
|---|---|
| Purchase Requisition Number | The PR number, format P2P-[CATEGORY]-[YEAR]-[NNNN], for example P2P-RAW-2026-0012. |
| Category | Category name (or code). |
| Project | The project label (existing project "serial — model", or a new project's name). |
| Required Date | The date the material is needed by. |
| Priority | Low, Medium or High. |
| Status | Coloured status pill (see Statuses below). A Submitted requisition where some but not all approvers have signed shows "Partially Approved". |
| (actions) | **View** link. |

What the list contains: up to 500 requisitions, newest first. The Purchase team sees every requisition in its data scope; other users see requisitions they raised, requisitions they approve (or approved) and, for Director / Partner / Purchase Head flag holders, the PO-stage requisitions. A draft is visible only to the person who raised it. Empty text: "You haven't raised any Purchase Requisitions yet."

Row actions: clicking a row or **View** opens the requisition view page.

#### Approvals view

Bucket buttons: **Waiting for me** (default), **Approved**, **Rejected**, **All** (a ?bucket= link parameter preselects one).

| Bucket | Statuses shown | Extra rule |
|---|---|---|
| Waiting for me | Submitted | Only requisitions waiting on the viewer: in the approval engine, the viewer can decide the live step (including as a delegate); on older requisitions, the viewer's own approval slot is unsigned. Admins see every pending one. |
| Approved | Approved and every later status up to Closed | — |
| Rejected | Rejected | — |
| All | Every status | — |

The list comes from the "pr-approval" queue: only requisitions where the viewer holds (or held) an approval step. Same columns as above (no filters). Clicking a row opens the requisition with ?from=approval, which shows the approve / reject header buttons for older requisitions.

#### Statuses & workflow

Requisition statuses and their colours on screen:

| Status | Label shown | Meaning |
|---|---|---|
| draft | Draft | Saved by the requester without submitting. Private to the requester; no approval started. |
| submitted | Submitted / Partially Approved | In PR approval. |
| returned | Returned for changes | An approver returned it, or the requester withdrew it from approval. The requester edits / resubmits or cancels it. |
| approved | Approved | PR approval complete; stock decisions and RFQ come next. |
| vendor_quotations | RFQ / Quotations | The RFQ has been saved and locked. |
| technical_evaluation | Technical Evaluation | Optional evaluation stage (backend only; not used by the current screens). |
| commercial_evaluation | Commercial Evaluation | Evaluation stage (backend only; not used by the current screens). |
| vendor_selected | Vendor Selected | A formally evaluated quotation was selected (backend only). |
| po_drafted | PO Draft | A draft PO exists and is being priced. |
| po_raised | PO Raised | The PO is in PO approval. |
| po_approved | PO Approved | The PO is approved and with the vendor; goods can be received. |
| partially_received | Partially Received | Some (not all) ordered quantity accepted at GRN. |
| received | Received | All ordered quantity accepted. |
| closed | Closed | Completed, short-closed, or closed automatically because every line was issued from stock. |
| rejected | Rejected | Rejected at PR approval or at PO approval. |
| cancelled | Cancelled | Cancelled by the requester or Purchase. |

Main path: Draft (optional) → Submitted → Approved → (stock decisions per line) → RFQ / Quotations → PO Draft → PO Raised → PO Approved → Partially Received → Received → Closed. Side exits: Returned, Rejected, Cancelled; Approved → Closed directly when every line is issued from stock.

### New / Edit Purchase Requisition — /dashboard/p2p/new (edit: /dashboard/p2p/new?edit=[signed ref])

Requires the **p2p** app. Title "New Purchase Requisition", "Edit Draft [number]" or "Edit Purchase Requisition [number]". **← Back** (top right) returns to the previous page.

Pre-fill: the form can open pre-filled from other modules — from Store's low-stock "Raise P2P Request" action or Production's shortage planner (one line with the item, make, quantity, Project/Inhouse = Inhouse and a remark such as "Auto-suggested from Store low-stock alert for part ..."), or from a multi-line selection such as Maintenance › Spares "Raise PR for selected" (several lines plus remarks). Nothing is submitted until the requester clicks a button.

When editing a requisition that is Submitted or Approved, an amber note says saving withdraws that approval: **Save & Submit** sends it for approval again, **Save as Draft** keeps it with the requester.

#### Create form

Section "Request Details":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project Type | dropdown | Yes (to submit) | Existing project, New project | Decides whether Project is picked or typed. |
| Project | searchable dropdown | Yes when type = Existing | Service-module projects, shown as "serial number — model name" (up to 1000, not deleted) | Shown unless type = New. The project's label is stored. |
| New Project Name | text | Yes when type = New | Free text | Shown only for type = New. |
| Purchase Requisition Category | dropdown | Yes (also for a draft) | Market Items (MKT), Pneumatic & Hydraulic (PNH), Raw Material (RAW), Electrical (ELE), Hardware & Consumables (HWC), Job Work (JOB), Others (OTH) | The code is part of the PR number. It decides the auto-assigned buyer. Cannot be changed after submission (only a draft is renumbered). |
| Required Date | date | No | Date picker | — |
| Requirement Type | dropdown | No | Material, Service, Material + Service, Capital Equipment, Others | — |

Category to auto-assigned buyer (set in code by email): MKT, PNH and RAW → suraj.panwar; ELE → manish.kumar; HWC → mahender.singh; JOB → gaurav.katiyar; OTH → no buyer. If the email matches no user, no buyer is assigned.

Section "Item Details" (one row per line; **+ Add Item** adds a row; **Remove** appears when there is more than one row):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| SL | read-only | — | Row number | — |
| Item (from Item Master) | searchable dropdown | Yes | Active Store Item Master items, shown "item code — item name · part number" | Must be an active Item Master item; never typed. A new item is added first in Store › Item Master (link opens in a new tab), then **refresh items** reloads the list without losing the form. |
| Make | text | No | Placeholder shows the master's make | If left blank, the Item Master make is stored. |
| Part Code | read-only | — | Item Master part number (or manufacturer part number) | Copied onto the line. |
| UOM | read-only | — | Item Master unit of measure | Copied onto the line. |
| Qty | number | Yes | — | Must be more than 0. |
| Project/Inhouse | dropdown | Yes (to submit) | Project, Inhouse | Used downstream to split Store issue / consumption. |
| Category | read-only | — | Item Master category | Copied onto the line. |
| Ship To | text | No | Free text | Used by the stock check to find the matching store. |

Section "Priority & Remarks":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Priority | dropdown | No (default Medium) | Low, Medium, High | — |
| Remarks | multi-line text | No | — | — |

Section "Approval": the read-only "Who approves" card (see Settings) showing each stage of the "Purchase requisition" and "Purchase order" workflows, the approvers and the rule (all must approve / any one approves), with a link to Organization › Approval Workflows.

Section "Documents":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Supporting Documents | file (multiple) | No | Any file | Uploaded to SharePoint after the requisition is saved (doc type "supporting"). |
| Specification / Reference File | file (multiple) | No | Any file | Uploaded after save (doc type "specification"). |

Buttons (bottom right):
- **Cancel** — goes back.
- **Save as Draft** — saves privately. Needs only a category; lines without an item are dropped; any kept line needs quantity more than 0. Status = Draft, no approval started.
- **Submit Purchase Requisition** (new or draft) / **Save & Submit for Approval** (editing a non-draft) — full validation: Project Type chosen; Project picked or new name given; category picked; every line has an Item Master item, Project or Inhouse, quantity more than 0; at least one line. Then the requisition is submitted into the "Purchase requisition" approval workflow.

On save the user is taken to the requisition view page. If any file upload fails, a warning dialog "Requisition Created — Some Files Not Uploaded" names the failed files and offers **Open Requisition**.

What the system does on submit: generates the PR number (P2P-[CATEGORY]-[YEAR]-[NNNN], sequence per category and year), records request date = today and department = requester's department, assigns the buyer from the category, copies item name / part code / unit / category from the Item Master onto each line, takes a store-stock snapshot for every line (In Stock / Partial / Not in Stock), writes the audit history, submits to the approval engine (which notifies the approvers by bell and Teams, or approves at once if the workflow is switched off, or refuses with the exact reason if a stage has nobody to approve), fires the "PR created" notification rule, and emails each pending approver in the background.

#### Edit

- Full edit (this same form with ?edit=) is allowed for the requester, an admin, or Purchase with "Edit" on Purchase Requisitions, while the status is Draft, Returned, Submitted or Approved AND no RFQ has been raised, no live PO exists, no line has been issued from stock, and the requisition was not raised from a Service Request's Materials tab. Otherwise the reason is shown and editing is refused.
- Editing a Submitted requisition cancels its live approval request; editing a Submitted or Approved one clears its approval. Saving as draft returns it to Draft; submitting sends it for approval afresh.
- The category cannot change once submitted (it is part of the number).
- Every saved line goes back to "Awaiting Decision" with a fresh stock snapshot.

### Purchase Requisition view — /dashboard/p2p/[signed ref]

Opens for anyone with "View" on Purchase Requisitions or Purchase Orders who may see this requisition: the requester, the Purchase team, approvers (PR stage or PO stage, including delegates and escalation targets) and Director / Partner / Purchase Head flag holders. A draft opens only for its requester (and admins). The page does not require the p2p app, because approvers often lack it. An edited or invalid link shows "Invalid link" with a way back to the list.

#### View page

Header: PR number, status pill, and the line "category · project" (or "No project specified").

Header buttons:

| Button | When it appears | What it does |
|---|---|---|
| ← Back | Always | Returns to the PR list, or to the PR / PO approval queue if opened from there. |
| Approve | Opened from the PR approval queue, status Submitted, requisition still on the old (pre-engine) approval path, and the viewer holds a pending slot (or is admin; or, with no named approvers, is Purchase team with "Approve") | Prompt "Approve this Purchase Requisition?" with a required comment. |
| Approve PO | Opened from the PO approval queue, status PO Raised, old-path PO, viewer holds a pending PO role | Prompt "Approve this PO?" with a required comment. If not available, an amber note explains why. |
| Reject | Same conditions as Approve / Approve PO (old path only) | Prompt with optional reason; the requisition becomes Rejected (at PO stage the PO is cancelled too). |
| Resubmit for Approval | Status Returned, "Submit" permission, viewer is the requester or Purchase | Sends it into approval again. |
| Submit for Approval | Status Draft and viewer is the requester | Checks the draft is complete (project, project type, at least one line, Project/Inhouse on every line) and submits it. |
| Edit Draft / Edit Requisition | The server says the viewer may edit it (see Edit rules above) | Opens the full edit form. |
| Discard Draft | Status Draft and viewer is the requester | Confirm dialog, then deletes the draft permanently and returns to the list. |
| Quick Edit | Purchase team with "Edit", not a draft, and editing is still allowed | Opens the "Edit Details" panel. |
| Close Requisition | Purchase team with "Edit" and status Received | Confirm "Close this Requisition?"; status becomes Closed (cannot be reopened). |
| Short-close Requisition | Purchase team with "Edit" and status Partially Received | Prompt with a required reason; the balance is written off, no more goods can be received; refused while a GRN is still awaiting inspection. |
| Cancel Requisition | "Cancel" permission AND (requester or Purchase) AND status Submitted, Returned, Approved, RFQ / Quotations, evaluation stages, Vendor Selected or PO Draft; or status PO Approved and viewer is Purchase | Prompt with reason (optional; required when the PO is already approved). Cancels the live approval request and any draft or approved PO. Refused at PO Raised (reject the PO instead), Partially Received (short-close instead), Received (close instead) and while a GRN is awaiting inspection. |

Information notes under the header: a grey "This is a draft — only you can see it ..." note on drafts; an amber "Editing is locked: [reason]" note when a requester or Purchase user cannot edit before the RFQ stage.

Quick Edit panel "Edit Details" (Purchase only):

| Field | Meaning |
|---|---|
| Project | Free-text project label. |
| Required Date | Date picker. |
| Requirement Type | Free text. |
| Priority | Low / Medium / High. |
| Remarks | Multi-line text. |

Buttons **Save Changes** (saves only these fields; status, approvers and project type cannot be changed this way) and **Discard**.

Section "Request Details":

| Field | Meaning |
|---|---|
| Department | Requester's department at the time of raising. |
| Requested By | Requester name. |
| Request Date | Date raised. |
| Required Date | Needed-by date. |
| Requirement Type | Material / Service / etc. |
| Priority | Low / Medium / High. |
| Buyer | Auto-assigned buyer. |
| Remarks | Shown only when present. |

Section "Purchase Order" (shown once a PO exists; vendor prices are shown only to Purchase, admins, Director / Partner / Purchase Head and the PO's approvers):

| Field | Meaning |
|---|---|
| PO Number | PO-[YEAR]-[NNNN]. |
| Vendor | PO vendor. |
| PO Date | PO date. |
| Expected Delivery | Promised delivery date. |
| PO Value (incl. tax) | Total of all priced lines including tax. |
| Lines table | SL, Item (item code — name · make), Qty with unit, Unit Price, Tax %, Line Total, and a Total row. |
| PO Document | An earlier uploaded PO file (old manual flow), or "No document attached." |

Older PO lines not linked to the Item Master show a "Not linked to Item Master" tag; the Purchase team with "Edit" on Purchase Orders (PO not fulfilled or cancelled) sees **Link to Item Master**, which opens a searchable item picker with **Link** / **Cancel**. The link is one-time and needed before goods can be received.

Section "Vendor Quotations" (when an RFQ with attachments exists): one card per quotation with tier (L1–L4), vendor name and the quotation file (click to open).

Section "PO Approval":
- When the PO is in the approval engine: the shared Approval panel titled "PO Approval" (see the Approval panel below).
- Engine requisition whose PO has not gone for approval yet: "— PO not sent for approval yet. It goes through the "Purchase order" workflow (Organization › Approval Workflows)."
- Older requisitions: the old per-role grid (Purchase Head / Director / Partner, or the matrix roles plus Director), each with name, Approved / Pending / Rejected pill and the quoted comment. Shown only once an RFQ exists or the PO has been raised.

Section "Approval" (PR approval):
- Requisitions in the approval engine: the shared **Approval panel** — status pill (Waiting for approval / Approved / Rejected / Returned for changes / Cancelled), "Submitted by ... on ...", the list of stages with each approver and step state (Not yet, Waiting, Approved, Rejected, Returned, Not needed, Cancelled). If the viewer can act: a comment box and **Approve**, **Return for changes**, **Reject** (a comment is required to approve, reject or return for this workflow; an admin who is not an approver may stand in with a comment). The requester may see **Withdraw approval request**. "Show earlier submissions" lists past submissions.
- Older requisitions: a grid of approver slots (matrix roles, or Department Head / Project Head / Plant Head) with name, pill and comment; a final "Cancelled" or "Rejected" cell when relevant.

Section "Item Details": a summary line "N of M line(s) available in store stock · checked [time]" (with "re-checked automatically at approval" while Submitted), then the table:

| Column | Meaning |
|---|---|
| SL | Line number. |
| Item Description | Item code — item name. |
| Make | Requested make. |
| Part Code | From the Item Master. |
| UOM | Unit. |
| Qty | Requested quantity. |
| Project/Inhouse | Project or Inhouse. |
| Category | Item category. |
| Ship To | Delivery location text. |
| Stock | Snapshot pill: In Stock, Partial ("x of y available"), Not in Stock, or Not linked to Item Master. |
| Attachments | Line-level files (click to open). |
| Fulfillment | Awaiting Decision, Issued from Stock ("qty unit @ location"), or In Procurement (with "x issued from stock · buying y" for a split line). |

Stock decision row (under each line still "Awaiting Decision", once the requisition is past approval and not rejected / cancelled, for Purchase with "Edit", the requisition's Store Manager, or admin): the stock check runs automatically and shows Matched Store Item, At Ship-To (available qty, or "Not a store — pick one below"), Total (All Locations) available, Requested Qty. Then:
- **Issue From** (store location dropdown with available qty) and **Issue Qty** (default = the most that location can cover) — shown only to the Store Manager picked on the requisition, or admin.
- **Issue from Stock** / **Issue [x] & Buy [y]** — prompt "Issue from Store Stock?" with a required comment. Creates a Store material issue, deducts stock from that location, and marks the line Issued from Stock (or In Procurement for the shortfall). If every line is issued, the requisition closes automatically. The requester gets a bell notification.
- **Send to Procurement** — shown to Purchase with "Edit" (or admin) when no single location covers the full quantity. Confirm dialog; the line becomes In Procurement (cannot be undone).
- Users who cannot issue see "Waiting for the Store Manager to issue from stock — or send it to procurement."

Section "Attachments": every requisition-level file with its type (supporting / specification).

#### Statuses & workflow

- **PR approval**: on submit the requisition goes to the "Purchase requisition" workflow (Organization › Approval Workflows). Default seeded from the old Procurement Settings PR approvers: every listed approver must approve. Approvers can approve (comment required), return for changes (→ Returned) or reject (→ Rejected, reason recorded). Self-approval is allowed for this workflow.
- **On final approval**: status → Approved; store stock is re-checked; lines not in stock (or not linked to the Item Master) go straight to procurement; fully available lines wait for the Store Manager to issue them; partial lines wait for a split decision. The buyer receives a bell notification "PR Approved — Stock Check Result" with the outcome; the "PR approved" notification rule fires.
- **RFQ**: once every line is decided and at least one is In Procurement, the requisition appears under R.F.Q.
- **Receiving**: GRNs (Store › GRN & Inspection) roll accepted quantities up: some accepted → Partially Received; all accepted → Received; reversed / returned to vendor can move it back.
- **Close / short-close / cancel**: as listed in the header buttons.

### Vendors — /dashboard/p2p/vendors

Opens for admins, users with "View" on Procurement › Vendors, the Purchase team and Accounts (Finance) users. Intro text: the vendor master is shared with Finance; RFQs pick vendors from here and POs link to them so the vendor's invoice matches the PO; bank and credit details are kept by Finance (Accounts → Vendors).

#### List view

Top buttons:

| Button | When shown | What it does |
|---|---|---|
| Export | "Export" on Vendors | Export dialog (ticked vendors or all shown, by added date), downloads an Excel file. |
| Import | "Import" on Vendors | CSV / Excel import with template vendor_import_template.csv. One vendor per row; only Company Name is required; a vendor already in the master (same name or same GSTIN) is left unchanged and counted as "Already in master". New vendors get the next code and status Active. |
| + Add Vendor | "Create" on Vendors | Opens the Add vendor dialog; after saving, opens the new vendor's page. |

Filters: a search box (name, code, GSTIN, city, contact name, contact phone — filtered on screen) and a status dropdown (Active — default, Inactive, Blocked, All statuses).

| Column | What it shows |
|---|---|
| Code | Vendor code, auto-generated as V-0001, V-0002, ... |
| Company | Vendor name. |
| Contact | Contact person · phone. |
| City | City. |
| GSTIN | GST number. |
| Catalog | Number of catalog items. |
| Docs | Number of documents. |
| Status | Active (green), Inactive (grey), Blocked (red). |
| (actions) | **View**. |

Row actions: click a row or View to open the vendor page.

#### Create form (Add vendor / Edit dialog)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Company name | text | Yes | — | "Company name is required." |
| Contact person | text | No | — | — |
| Contact number | text | No | — | Used as the default contact on RFQ vendor slots. |
| Email | text | No | — | Used as contact if no phone. |
| Address | text | No | — | — |
| City | text | No | — | — |
| State | text | No | — | — |
| PIN | text | No | — | — |
| GSTIN | text | No | — | Must be unique across vendors ("GSTIN ... is already on vendor ..."). Sets the GST registration type to regular (with GSTIN) or unregistered on create. |
| Website | text | No | — | — |
| Status | dropdown | Yes (default Active) | Active, Inactive, Blocked | Only Active vendors can be picked on an RFQ. |
| Vendor's terms & conditions | multi-line text | No | — | Copied onto POs to this vendor, after the company's own terms. |

On create the "Vendor added" notification rule fires and an audit entry is written.

### Vendor page — /dashboard/p2p/vendors/[signed ref]

Opens for admins, the Purchase team and Accounts users.

#### View page

Header: vendor code, vendor name; buttons **← Back** and **Edit** (with "Edit" on Vendors; opens the same dialog pre-filled).

Section "Details":

| Field | Meaning |
|---|---|
| Contact person | Contact name. |
| Contact number | Phone. |
| Email | Email. |
| Address | Address, city, state, PIN joined. |
| GSTIN | GST number. |
| Website | Website. |
| Status | active / inactive / blocked. |
| Vendor's terms & conditions | The vendor's own terms. |

Section "Documents" (catalog PDF, GST certificate, PAN, MSME, cancelled cheque ...):
- With "Edit" on Vendors: a document-type dropdown (Catalog / price list, GST certificate, PAN card, MSME / Udyam certificate, Cancelled cheque, ISO / quality certificate, Other) and **Upload** (multiple files, stored in SharePoint under Procurement-media/vendors/[code]).
- Table: File (click to open), Type, Uploaded by, On, and **Delete** (only with "Delete" on Vendors and only for a document the user uploaded; admins any). Delete asks for confirmation.

Section "Catalog — items this vendor sells":
- Buttons: **Export** (with "Export"; downloads [code]_catalog.xlsx), **Import** (with "Import"; template vendor_catalog_template.csv — an item with the same name and part code is updated, others added; result shows Added / Updated / errors), **+ Add item** (with "Edit").
- Add / edit item form: Item name (required), Part code, Make, Unit, Price (number, cannot be negative), Currency (default INR), Dimensions, Lead time (days, number, cannot be negative), Technical specification; **Cancel** / **Add item** or **Save item**.
- Table: Item, Part code, Make, Unit, Price (currency + amount), Dimensions, Technical spec, Lead time (days), and **Edit** / **Delete** (with "Edit"; delete asks for confirmation).
- Catalog prices are used to suggest vendors on the RFQ form and to pre-fill PO line prices.

### R.F.Q — /dashboard/p2p/rfq

Requires the **p2p** app; the RFQ API needs the **purchase** app and "View" on R.F.Q.

#### List view

Section "Purchase Requests Awaiting RFQ" — approved requisitions with no RFQ yet, where no line is still "Awaiting Decision" and at least one line is In Procurement.

| Column | What it shows |
|---|---|
| Purchase Requisition Number | PR number. |
| Category | Category. |
| Project | Project label. |
| Required Date | Needed-by date. |
| (actions) | **Start RFQ** (Purchase team with "Create" on R.F.Q). |

Clicking a row (same users) opens Raise RFQ for that requisition. Empty text explains the readiness rule.

Section "RFQs" — every RFQ in the user's data scope, newest first:

| Column | What it shows |
|---|---|
| RFQ Number | RFQ-[YEAR]-[NNNN]. |
| Purchase Requisition Number | Linked PR. |
| Status | Draft (amber) or Locked (green). |
| Single Quotation | Yes when only L1 was attached. |
| Created | Creation date. |
| (actions) | **View**. |

#### Create form — Raise RFQ (/dashboard/p2p/rfq/new?pr_id=[signed ref])

Only the Purchase team ("Only the Purchase team can raise an RFQ.") with "Create" on R.F.Q.

Step 1 "Purchase Requisition":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Purchase Requisition | searchable dropdown (or fixed text when opened from Start RFQ) | Yes | Approved requisitions ready for an RFQ | Shows the project and a "To Be Quoted" list: each In Procurement line with the quantity still to buy (requested minus issued from stock). |

Step 2 "Supplier / Vendor Quotations" — four slots, L1 Vendor (required), L2, L3, L4 (optional), each with:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Vendor (from master) | searchable dropdown | Yes for L1; yes for any slot with a file | Active vendors, "name (code) — city" | Picking fills the contact from the vendor's phone or email. Inactive / blocked vendors are refused by the server. |
| Contact Number | text | Yes for L1 | Pre-filled from the vendor | — |
| Quotation | file | Yes for L1 | Any file | Stored in SharePoint. |

Below the slots: "At least the L1 Vendor quotation must be attached." when none is attached, and a blue suggestions box "Vendors whose catalog has these items" listing up to 8 vendors whose catalog matches the to-be-quoted items (most items first, then lowest catalog total).

"Single Quotation" section (appears when only L1 is attached):

| Field | Type | Required | Rules |
|---|---|---|---|
| Reason for Single Quotation | multi-line text | Yes | Required when only L1 is attached. |
| Comments | multi-line text | Yes | Required when only L1 is attached. |

Step 3 "L1 Vendor Commercial Terms":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Payment Terms | text | Yes | e.g. "50% advance, 50% on delivery" | Later used as the PO's delivery / payment terms. |
| Delivery Lead Time | text | Yes | e.g. "4 weeks" | — |
| Late Delivery Clause | multi-line text | Yes | — | — |
| Terms & Conditions (company) | multi-line text | No | Pre-filled from Procurement › Settings "Standard terms & conditions" | Editable for this RFQ. The L1 vendor's own terms are shown below it. Both go onto the PO: company terms first, then the vendor's. |

A warning says "Once saved, this RFQ is locked and cannot be edited." Buttons **Save RFQ** and **Cancel**.

On Save RFQ the system: creates the RFQ (or reuses an existing draft RFQ for the same requisition), uploads each attached quotation, saves the terms, then submits and locks it. Server checks: requisition is Approved; no line awaiting decision; at least one line In Procurement; an L1 attachment exists; single-quotation reason and comments when only L1; payment terms, lead time and late delivery clause filled. On lock, the requisition moves to **RFQ / Quotations** and the RFQ is marked single-quotation if only L1. The "RFQ created" notification rule fires when the RFQ is first created.

### RFQ view — /dashboard/p2p/rfq/[signed ref]

#### View page

Header: RFQ number, status pill (Draft / Locked), "Purchase Requisition [number]". Buttons: **← Back**; **Admin Edit** / **Close Edit** (admin only, on a locked RFQ).

Section "Supplier / Vendor Quotations": a card per tier L1–L4 that has a quotation — vendor name, contact and the file (click to open).

Section "Purchase Order" (locked RFQ whose requisition is past Approved), with a stage pill (Pending PO, PO Draft, Sent for PO Approval, PO Approved) and **Open in Purchase Orders →**:
- No PO yet: "Next: select the vendor and create the PO. L1 ([vendor]) is pre-selected ..." and **Select Vendor & Create PO →** (with "Create" on Purchase Orders; otherwise a note says Create access is needed). Opens the Purchase Order page with the vendor-pick dialog open.
- PO Draft: PO Number and Vendor; "Terms & Conditions on this PO" (editable text); "Line Prices" table — Item (with an optional Specification box printed under the item on the PO, one point per line), Qty, Unit Price (required, more than 0), Tax % (0–100), Line Total; "PO value (incl. tax)" with a count of lines still needing a price; **Save Prices** (with "Edit" on Purchase Orders); the compact "Who approves" card; **Send for Approval** (with "Edit" on Purchase Orders; the server also needs "Submit"). Send asks for confirmation ("The PO value of ... will be sent for approval ... and the PO can no longer be edited here"), saves the prices, then submits.
- PO Raised and later: PO Number, Vendor, PO Value, a message (sent for approval / approved) and **View Approval Status** (opens the requisition page from the PO approval context).

Section "Admin Edit" (admin, when toggled): Payment Terms, Delivery Lead Time, Late Delivery Clause, and for single-quotation RFQs Reason for Single Quotation and Comments; **Save Changes**.

Otherwise: "Single Quotation" section (reason and comments, when single) and "L1 Vendor Commercial Terms" (Payment Terms, Delivery Lead Time, Late Delivery Clause).

Section "Details": Created By, Created At, Locked At.

#### Edit

A locked RFQ cannot be edited by anyone except an admin (server message "This RFQ has been submitted and is locked. Only an admin can edit it."). Quotation files can be removed only while the RFQ is a draft, by a user with "Delete" on R.F.Q who uploaded the file.

#### Statuses & workflow

RFQ statuses: **Draft** (being prepared) → **Locked** (saved; requisition moves to RFQ / Quotations). The backend also contains a structured evaluation flow (vendor quotation records, technical evaluation, commercial evaluation, vendor selection — gated by "Approve" / "Reject" on R.F.Q), but no current screen uses it.

### Purchase Orders — /dashboard/p2p/purchase-orders

Header "Purchase Orders" with **+ Create PO** (Purchase team with "Create" on Purchase Orders). View tabs, each shown only to the right people: **Create PO** (Purchase team with "Create"), **Approvals** (PO approvers and admins), **Tracking** (Purchase team and admins). A ?view= link parameter preselects a view. Users with none of these see "Purchase Orders are for the purchase team and the PO approvers."

#### List view — Create PO

Intro: "Requisitions whose RFQ is complete. Create the PO to the L1 vendor, price it and send it for approval." Lists locked RFQs whose requisition is at RFQ / Quotations (or an evaluation stage, Vendor Selected) or PO Draft.

| Column | What it shows |
|---|---|
| Requisition | PR number. |
| RFQ | RFQ number. |
| L1 Vendor | Lowest quote vendor. |
| Other quotes | "L2 vendor, L3 vendor ...". |
| Stage | Ready for PO (blue) or PO in draft (amber). |
| (actions) | **Create PO** (opens the Create PO dialog) or **Continue PO** (opens the Purchase Order page). |

#### Create form — Create Purchase Order dialog

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| 1. Requisition | searchable dropdown | Yes | Requisitions ready for a PO, "PR number — RFQ number" | Shows the PR number, project, required date and the lines still to be bought with quantities. If none is ready: "No requisition is ready for a PO ...". |
| 2. Vendor (from the RFQ quotes) | radio list | Yes | One option per quoted tier: tier, vendor, contact; "not in vendor master" if typed by hand; L1 marked "lowest" | L1 is the default. |
| Why not L1 (lowest)? | multi-line text | Yes when a tier other than L1 is picked | e.g. "L1 can't deliver before the required date" | Recorded in the requisition history. |
| Expected delivery | date | No | — | — |

Buttons **Cancel** and **Create PO**. Server rules: requisition at RFQ / Quotations or Vendor Selected; the chosen tier must exist on the RFQ; PO number generated as PO-[YEAR]-[NNNN]; PO date = today; delivery terms = the RFQ payment terms; terms and conditions = the RFQ company terms then the vendor's terms; PO lines = the requisition lines not issued from stock, with quantity = requested minus issued (lines cannot be typed in); the vendor is linked to the vendor master when picked from it; the Quality module blocks a PO to a vendor BLOCKED on the approved vendor list for those items. The requisition moves to **PO Draft** and the user lands on the Purchase Order page.

#### List view — Approvals

Bucket buttons: **Waiting for approval** (status PO Raised), **Approved** (PO Approved, Partially Received, Received, Closed), **Rejected**, **All**. The list is the "po-approval" queue: requisitions whose PO the viewer approves (approval engine steps, named older PO approver rows, or the Director / Partner / Purchase Head flags for older POs).

| Column | What it shows |
|---|---|
| Purchase Requisition Number | PR number. |
| Category | Category. |
| Project | Project. |
| Required Date | Needed-by date. |
| Priority | Priority. |
| PO Value | Rupee value of the PO. |
| Status | Status pill. |
| (actions) | **View**; **Approve** and **Reject** inline when the PO is PO Raised and the viewer can decide (engine: the live step; older POs: a pending PO role). Approve needs a comment; Reject needs a reason (sent to the buyer and recorded). |

Row click opens the requisition page from the PO-approval context.

#### List view — Tracking

Intro "Delivery status of every raised purchase order." Filters: status dropdown (All Statuses, Draft, Issued, Acknowledged, Partially Fulfilled, Fulfilled, Cancelled) and **Overdue only** checkbox.

| Column | What it shows |
|---|---|
| PO Number | PO number. |
| Against PR | Requisition number, or "Ad-hoc" for a PO without one. |
| Vendor | Vendor name. |
| PO Date | PO date. |
| Expected Delivery | Expected delivery date. |
| Buyer | The requisition's buyer. |
| Status | Draft, Issued, Acknowledged, Partially Fulfilled, Fulfilled, Cancelled. |
| Overdue | "[n]d overdue" in red when the PO is Issued, Acknowledged or Partially Fulfilled and today is past the expected delivery; otherwise "—". |

Row click (when linked to a requisition) opens the requisition page.

#### Statuses & workflow (PO)

| PO status | Meaning |
|---|---|
| Draft | Created from the RFQ; being priced. Also the state after a PO is returned for changes. |
| Issued | Sent for approval (and remains Issued after approval until goods arrive). |
| Acknowledged | Defined status; no current screen sets it. |
| Partially Fulfilled | Some ordered quantity accepted at GRN. |
| Fulfilled | All ordered quantity accepted. |
| Cancelled | Cancelled with the requisition, or the PO was rejected at approval. |

PO approval runs in the "Purchase order" workflow (Organization › Approval Workflows). Default: every "PO approver" seeded from the old Settings list (all must approve), then any one Partner (Company Info → Partners) gives the final approval. The buyer who sends the PO cannot approve it, and one person cannot fill two stages. A comment is required to approve. Outcomes: approved → requisition PO Approved and the "PO approved" rule fires; rejected → requisition Rejected and the PO Cancelled; returned / withdrawn → PO back to Draft, requisition back to PO Draft.

### Purchase Order page — /dashboard/p2p/purchase-orders/new?rfq=[signed ref]

Purchase team (or admin) only. Header: "PR number · RFQ number", title "Purchase Order [number]" (or "Create Purchase Order"), "Project: ...", and **← Back** to Purchase Orders. Without an RFQ in the link it says to open the page from Purchase Orders → Create PO.

The draft is editable only when the PO is Draft, the requisition is PO Draft, and the user has "Edit" on Purchase Orders.

#### View page / Edit

Card "1. Vendor & order details":

| Field | Meaning / editing |
|---|---|
| Vendor (L1 on the RFQ) | The PO vendor. A warning shows if it was typed by hand on the RFQ instead of picked from the vendor master (Finance cannot auto-match its invoice). |
| PO number | Generated number (after the PO exists). |
| Expected delivery | Date picker when editable. |
| Delivery / payment terms | Text when editable (placeholder = the RFQ payment terms). |

If no PO exists yet and the user has "Create": **Choose vendor & create PO** opens the Create Purchase Order dialog.

Card "2. Line prices": Item (name and part code), Qty, Unit price (required, more than 0; pre-filled from the vendor's active catalog when the catalog lists the item by part code or name, marked "from vendor catalog"), Tax % (0–100), Line total = qty × price × (1 + tax/100). "PO value (incl. tax)" with the count of unpriced lines, and a note when the vendor has no catalog prices.

Card "3. Terms & document":
- "Terms & conditions on this PO" — editable text (company terms, then the vendor's terms).
- "Purchase Order document (Word, on the company letterhead)": **Save & Edit in Word** (editable only) saves the page, then opens the managed Word document in Word Online. The document panel offers **Create Word** (or "Create Word for current revision"), **Edit in Word**, **Upload revised .docx**, **Regenerate** (rebuild from the page after prices or terms change), **Download .docx**, and version history. Any draft edit raises the PO revision so the panel knows the Word file is out of date.
- "Earlier attached PO file" — a file attached under the old manual flow, if any.

Card "4. Approval":
- For requisitions on the old "settings" approval scheme: the compact "Who approves" card, **Save draft** and **Send for approval** (blocked until every line has a price; confirm "PO ... goes to the PO approvers, then any one Partner. Prices are locked while it is in approval.").
- For every other requisition (this includes all requisitions submitted through the approval engine): the text "This requisition was raised before approvers moved to Settings — its PO approvers are picked by name." with the link **Pick them and send the PO on the RFQ page →**. Sending is then done with **Send for Approval** on the RFQ view page.
- Once sent: "Sent for approval — waiting on the PO approvers / a Partner.", "Rejected at approval." or "Approved.", with **View approval status**.

Server rules on send: the requisition must be PO Draft and the PO Draft; the PO must have lines; every line needs a unit price above 0. The PO value, PO date, expected delivery and ordered quantity are copied onto the requisition, the PO becomes Issued, the requisition PO Raised, the "PO raised" notification rule fires, and every pending PO approver gets an email with the PO.

### PO approval link — /dashboard/p2p/purchase-orders/[signed ref]

Not a screen of its own: the approval engine's PO approval notifications link here with the PO id. The page looks up the PO's requisition and redirects to the requisition view page (from the PO-approval context), where the PO is approved. Shows "Opening the purchase order…", an error if the PO cannot be opened, or "Invalid link" for an edited link.

### M.I.S Report — /dashboard/p2p/mis

Fully described in Section 2 (period selector, KPI tiles, two charts, pending-by-approver table, Excel export). Requires the p2p app; the data needs Purchase team / Purchase Head / Director / Partner / admin and "View" on M.I.S Report (export needs "Export").

### Settings — /dashboard/p2p/settings

Described in Section 4. Opens for admins and users with the p2p or purchase app; reading needs "View" on Procurement › Settings and saving needs "Edit".

## 4. Settings / Masters

### Procurement settings (/dashboard/p2p/settings)

Built on the shared module-settings page (each setting can be saved, and reset to its default). Contents:

| Section | Setting | What it controls |
|---|---|---|
| Who approves (read-only card at the top) | — | Shows each stage of the "Purchase requisition" (PR) and "Purchase order" (PO) approval workflows with the people who would approve for the viewer and the rule (all must approve / any one approves). Shows "Workflow switched off — approved automatically" when a workflow is inactive, and a red warning when a stage has nobody. Approvers are edited in Organization › Approval Workflows, not here. A requisition or PO already in approval keeps the approvers it started with. |
| Company terms & conditions | Standard terms & conditions (long text, one clause per line) | Copied onto every new RFQ and PO next to the vendor's own terms, where it can still be adjusted. Printed on the Word PO as the numbered Declaration. Default: six clauses (quote the PO number on all documents; payment 45 days after receipt unless specified; supplies subject to inspection and acceptance; advance payments to be shown on bills; delivery within the PO time or the order may be cancelled / bought at the supplier's cost; HARYANA jurisdiction). |
| Notification — PR created | Send this notification (on/off), Notify these people, Channels (Bell / Email / Teams), Also email these addresses | Sent when a new requisition is raised (or a draft is submitted). |
| Notification — PR approved | same four fields | Sent when a requisition gets its last PR approval. |
| Notification — PR rejected | same four fields | Sent when a requisition is rejected (including at PO approval). |
| Notification — RFQ created | same four fields | Sent when an RFQ is created for a requisition. |
| Notification — PO raised | same four fields | Sent when a PO is submitted for approval. |
| Notification — PO approved | same four fields | Sent when a PO gets its final approval. |
| Notification — Vendor added | same four fields | Sent when a vendor is added to the vendor master. |

Notification rule validation: extra email addresses must be valid; a switched-on notification must have people or email addresses; people selected need at least one channel. The person who did the action is not notified. Recipients may be from any department.

### Fixed masters (in code, not configurable)

| Master | Values |
|---|---|
| PR categories | MKT Market Items, PNH Pneumatic & Hydraulic, RAW Raw Material, ELE Electrical, HWC Hardware & Consumables, JOB Job Work, OTH Others. |
| Requirement types | Material, Service, Material + Service, Capital Equipment, Others. |
| Priorities | low, medium, high. |
| Project types | existing, new. |
| Category auto-buyers | MKT / PNH / RAW: suraj.panwar; ELE: manish.kumar; HWC: mahender.singh; JOB: gaurav.katiyar. |
| Number series | PR P2P-[CAT]-[YEAR]-[NNNN] (per category per year); RFQ-[YEAR]-[NNNN]; PO-[YEAR]-[NNNN]; vendor code V-[NNNN]. |
| Vendor document types | Catalog / price list, GST certificate, PAN card, MSME / Udyam certificate, Cancelled cheque, ISO / quality certificate, Other. |

### Vendor master

The Vendors tab is the master data screen (see Section 3). It is the same vendor table Finance uses in Accounts → Vendors; bank, credit and GL details are maintained there.

## 5. Permissions

Access combines the user's apps, the Permission Matrix (Organization › Role & Permissions) and data scope.

### Apps

| App | Meaning in Procurement |
|---|---|
| p2p | Requester access: raise and follow requisitions, open Settings. Required for the PR list, New PR, R.F.Q page shell and M.I.S page shell. |
| purchase | The Purchase team (buyers): Vendors, R.F.Q, Purchase Orders (Create PO, Tracking), M.I.S, quick edit, stock decisions, close / short-close, cancel any requisition. Required by the RFQ, PO and close APIs. |
| accounts | Can open the Vendors master. |

### Permission Matrix keys (module p2p)

| Tab key | Actions | What they gate |
|---|---|---|
| p2p:purchase_requisitions | view, create, edit, delete, approve, reject, export, print, submit, cancel | view: open requisitions and approve / reject as a named approver; create: New PR, Import, submitting a draft, attachments on own PR; edit: Purchase quick edit, full edit by Purchase, stock decisions, close / short-close; submit: resubmit a returned PR; cancel: Cancel Requisition; export: Export; approve / reject: only for older requisitions with no named approvers. |
| p2p:vendors | view, create, edit, delete, export, import | Vendor list and page, add, edit (incl. documents and catalog), delete own documents, export, import. |
| p2p:rfq | view, create, edit, delete, approve, reject, export, print | view: RFQ list / page; create: Start / Raise RFQ; edit: attachments, terms, lock; delete: remove own quotation file on a draft; approve / reject: the (unused) evaluation steps. |
| p2p:purchase_orders | view, create, edit, delete, approve, reject, export, print, submit, cancel | view: PO list, PO approval queue, approving as a named PO approver; create: Create PO; edit: price the draft, terms, Word document, link PO lines; submit: send the PO for approval. |
| p2p:mis | view, export, print | Open the M.I.S data; Export Excel. |
| p2p:settings | view, edit | Read / save Procurement settings. |

Older grant names p2p:pr_approval:* and p2p:po_approval:* are mapped to purchase_requisitions and purchase_orders. A migrated role "Procurement – Approver" gives p2p:purchase_requisitions:view and p2p:purchase_orders:view to people who approved before roles existed.

### Role flags and routing

- Approvers are decided by the approval workflows, not by the matrix "Approve" box: a named PR approver needs only "View" on Purchase Requisitions; a PO approver needs only "View" on Purchase Orders.
- Director, Partner and Purchase Head flags: see all PO-stage requisitions, approve older in-flight POs, open the M.I.S data. Partners (Company Info → Partners) are the default final PO approval stage.
- Store Manager picked on a requisition (older requisitions with approver rows) or admin: issue lines from store stock.
- Admin: sees and can act on everything (stand in on approvals with a comment).
- Drafts are visible only to their requester.

### Data scope

| Record | own | assigned | department |
|---|---|---|---|
| Purchase requisition | requester | the buyer | the requisition's department |
| Purchase order | who drafted it | buyer of its requisition | — |
| RFQ | who started it | buyer of its requisition | — |

Approvers (and their delegates / escalation targets) always see what they approve, whatever their scope. Plant scope is the owner's plant.

## 6. Documents, Notifications & Integrations

### Documents

| Document | Where | Details |
|---|---|---|
| Purchase Order (managed Word document) | Purchase Order page, card 3 | Generated on the company letterhead, laid out like the company's Tally purchase order: Invoice To / Supplier block, voucher number, date, references, mode of payment, dispatch, destination, terms of delivery; Description of Goods grid (Sl, Description with specification lines, GST rate, quantity, rate, per, amount); CGST + SGST (same state, from the GSTIN state code) or IGST; round-off, total, amount in words, company PAN; the numbered Declaration from the PO terms (company default if empty); "for [company] / Authorised Signatory". Edited in Word Online with every save versioned; Regenerate rebuilds it; Download .docx. |
| Earlier attached PO file | Requisition and PO pages | A signed PO uploaded once under the old manual flow; read-only. |
| Requisitions Excel | PR list › Export | purchase_requisitions.xlsx, one row per item line. |
| Vendors Excel / catalog Excel | Vendors list › Export; Vendor page › catalog Export | Excel downloads. |
| M.I.S Excel | M.I.S Report › Export Excel | Multi-sheet workbook with charts. |
| Import templates | PR Import, Vendor Import, Catalog Import | CSV templates. |
| Attachments | Requisition (supporting / specification), RFQ quotations, vendor documents | Stored in SharePoint; opened inside the app. |

### Notifications

| Event | Who is told | Channel |
|---|---|---|
| PR submitted (new, draft submitted, resubmitted, edited and resubmitted) | Approvers of the current stage | Bell and Teams from the approval engine; plus an approval email to each pending approver. |
| PR final approval | Assigned buyer: "PR Approved — Stock Check Result" (lines sent to procurement / available / partial); requester (older path: "P2P Request Approved") | Bell. |
| PR rejected (older path) | Requester | Bell. |
| PR cancelled by someone else | Requester | Bell. |
| Buyer assigned (backend endpoint) | The buyer | Bell. |
| Line issued from stock | Requester | Bell. |
| Requisition closed / short-closed | Requester | Bell. |
| PO sent for approval | Approvers of the current PO stage | Bell and Teams from the engine; plus an email with the PO to each pending approver. |
| PR created, PR approved, PR rejected, RFQ created, PO raised, PO approved, Vendor added | People configured in Procurement › Settings | Bell / Email / Teams as configured, plus extra email addresses. |

Every action is also written to the requisition's audit history (and to the RFQ or vendor audit log).

### Links to other modules

- **Store › Item Master**: every requisition line is an active Item Master item; name, part code, unit and category are copied from it. The item id travels PR line → PO line → GRN line.
- **Store stock**: stock snapshot at raising and re-check at approval; issue from stock creates a Store material issue and a stock ledger "issue" transaction against the requisition.
- **Store › GRN & Inspection and Return to Vendor**: goods received against approved POs move the PO (Partially Fulfilled / Fulfilled) and the requisition (Partially Received / Received); reversals and returns move them back. Requisitions cannot be cancelled or short-closed while a GRN awaits inspection.
- **Quality**: a vendor blocked on the approved vendor list cannot get a PO for those items.
- **Accounts / Finance**: shared vendor master; PO vendor link and priced lines feed Finance's invoice 3-way match.
- **Service module (ERP)**: projects for the Project picker; requisitions raised from a Service Request's Materials tab (edited there, not here).
- **Store low-stock, Production shortage planner, Maintenance › Spares**: open the New PR form pre-filled.
- **Organization › Approval Workflows**: owns the "Purchase requisition" and "Purchase order" approval routing; **Organization › Role & Permissions** owns the permission keys and data scope; **Company Info → Partners** defines the Partners.
- **Ongoing Projects**: the old Procurement "Project Work" link forwards there.
