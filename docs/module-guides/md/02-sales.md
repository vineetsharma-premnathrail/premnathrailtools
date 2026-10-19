# Sales Module

The Sales module holds the **Sales Order (SO)**: the contract record of one customer purchase order (PO) or Letter of Acceptance (LOA). It sits right after CRM/BD in the core business flow (Customer, BD, R&D, Design/EHP, BOM, Store/Purchase, Production, QC, Dispatch, Commissioning, Machine, Service, Finance). A won CRM inquiry or awarded tender (or a PO received directly) becomes a draft sales order. The order goes through an approval chain. On final approval it is confirmed and gets its SO number, and the CRM inquiry or tender is closed as ordered. After that, Production links one RRV build to each vehicle on the order. Sales then tracks every vehicle's delivery date, build stage, risk and liquidated damages (LD) until it is delivered and the order is closed. Customer changes after confirmation go through **amendments**. Customer-granted delay relief is recorded as a **delivery-period (DP) extension**. LD is calculated and shown in Sales but never posted to the books. Invoicing is planned to move to Finance in a later phase.

## 1. Navigation Tabs

The Sales sub-nav (SalesNav) is at the top of every Sales page. It only shows the tabs the user has permission to see. On the right it also has a guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/sales | The Sales dashboard: tiles for the order book, the delivery backlog and LD exposure, plus action lists |
| Sales Orders | /dashboard/sales/orders | The list of sales orders, with links to create and view orders |
| Delivery | /dashboard/sales/delivery | The Delivery Schedule board: every open vehicle on confirmed orders, plus open DP extension requests |
| Reports | /dashboard/sales/reports | Sales Reports: Order book, Backlog by delivery month, LD exposure |
| Settings | /dashboard/sales/settings | Sales settings (approval, standard terms, new-order defaults, delivery tracking) |

These pages are not in the sub-nav: /dashboard/sales/orders/new (New Sales Order form), /dashboard/sales/orders/[ref] (order view page) and /dashboard/sales/amendments/[ref] (redirect page for amendment links).

## 2. Dashboard

Route: /dashboard/sales. Title "Sales Dashboard", subtitle "Order book, delivery backlog and LD exposure." All data comes from a single call to the dashboard endpoint and is limited to the orders inside the user's data scope.

### Header

- **Actions:** the "+ New Sales Order" button opens /dashboard/sales/orders/new.

### KPI tiles

There are five tiles in a row. "Open orders" means orders with status Confirmed, In execution, Partially delivered or On hold.

| Tile | Main value | Sub-line | How it is computed |
|---|---|---|---|
| Open order value | Total value of open orders, incl. GST (₹) | "N order(s)" | Sum of grand total over all open orders |
| Units due this month | Number of units | "by current delivery date" | Sum of quantities of undelivered delivery rows whose current delivery date falls in the current month (IST) |
| Overdue units | Number of overdue vehicles (red when above zero) | "N more at risk" | Count of undelivered rows with risk "overdue", and of rows with risk "at risk" |
| LD accrued | ₹ LD accrued on open vehicles (red when above zero) | "forecast ₹X" | Sum of accrued LD and forecast LD per order on undelivered rows. Each order's total is capped at whatever is left of its contract-value LD cap |
| Pending approval | Number of orders | "orders" | Count of orders with status Pending approval (within data scope) |

- **Actions:** none (the tiles cannot be clicked).

### Approvals waiting for me

A table of orders that are pending approval and that the current user can decide now. For orders on the central approval engine, this means the user is an approver of the current stage. For older orders on the legacy chain, it means the user holds the next level and is not the submitter (admins included).

| Column | What it shows |
|---|---|
| Order | Display number (SO number, or "Draft #id") |
| Customer | Customer name |
| Value | Grand total (₹) |
| As | The engine stage name, or the legacy level (Sales Head / Director / Partner) |

- Empty text: "Nothing waiting for your approval."
- **Actions:** clicking a row opens that order's view page.

### DP extensions waiting for the customer

Every DP extension request with status "requested" on orders inside the user's scope.

| Column | What it shows |
|---|---|
| Order | Order display number |
| Vehicles | Number of delivery rows in the request |
| Requested date | The new date requested |
| Reason | Reason category label |

- Empty text: "No open DP extension requests."
- **Actions:** clicking a row opens the order on its Delivery Schedule tab.

### Vehicles at risk or overdue

Shows up to 25 undelivered delivery rows that carry a risk flag, sorted by current delivery date.

| Column | What it shows |
|---|---|
| Order | Order display number |
| Vehicle | "L<line no.>/<sequence>" |
| Due | Current delivery date |
| Build | Linked RRV build number, or "none" |
| Stage | Current production stage of the build, or else the row status label |
| Risk | Pill "Overdue" (red) or "At risk" (amber) |
| LD | Accrued LD plus forecast LD for the row (₹) |

- Empty text: "Every open vehicle is on track."
- **Actions:** clicking a row opens the order on its Delivery Schedule tab.

## 3. Screens

### Sales Orders list (/dashboard/sales/orders)

Title "Sales Orders". Subtitle "One order per customer PO / LOA. Drafts get their SO number at confirmation."

#### List view

Top button: "+ New Sales Order" opens /dashboard/sales/orders/new.

Filters (they apply automatically about 0.25 seconds after you stop typing):

| Filter | Type | Behaviour |
|---|---|---|
| Search | text | Matches SO number, customer PO number, customer name or LOA number (partial match, case-insensitive) |
| Status | dropdown | "All statuses" or one status (Draft, Pending approval, Confirmed, In execution, Partially delivered, Delivered, Closed, On hold, Cancelled, Short-closed). Can be pre-set from the URL (?status=) |
| Due month | text, YYYY-MM | Orders that have at least one delivery row with a current delivery date in that month. The filter is only applied once the value has the full YYYY-MM form |
| Waiting for my approval | checkbox | Pending-approval orders the user can decide now. Can be pre-set with ?mine=1 |
| At risk / overdue | checkbox | Orders with at least one at-risk or overdue vehicle |

Sort: newest created first. The list only shows orders inside the user's data scope.

| Column | What it shows |
|---|---|
| Order | Display number (SO/FY/NNNN once confirmed, otherwise "Draft #id") |
| Customer | Customer name |
| Customer PO | PO number, followed by the PO date |
| Value (incl. GST) | Grand total (₹) |
| Units | Units delivered / total units (non-cancelled delivery rows) |
| Next due | Earliest current delivery date among undelivered rows |
| Risk | "N overdue" (red), else "N at risk" (amber), else a dash |
| Status | Status pill. Under it, "with <stage or level>" while the order is waiting for approval |
| (action) | "View" link |

- Row actions: clicking the row or "View" opens the order view page.
- Empty states: "No orders match these filters." when filters are set. Otherwise "No sales orders yet. Create one from a won inquiry or tender, or directly from a customer PO."

### New Sales Order (/dashboard/sales/orders/new)

The form can be opened in three ways:

- Directly. The subtitle reads "Direct order from a customer PO", and the contract terms are pre-filled from the Sales Settings defaults.
- From a CRM inquiry (?inquiry=<signed ref>), using the "Create Sales Order" button on the inquiry. The customer, contact, source, payment terms (from the quotation), delivery terms (the quotation's delivery time) and inspection agency (RITES or RDSO if mentioned in the inquiry's inspection requirement) are pre-filled. Lines are pre-filled from the quotation chosen as follows: the quotation the customer accepted or won; else the newest quotation that was not rejected; else the inquiry's line items with no prices. A coloured note explains which source was used: blue when prices were copied from an accepted quotation, amber otherwise. One vehicle row per RRV unit is generated, dated with the inquiry's required delivery date.
- From a CRM tender (?tender=<signed ref>). The customer, contact, LOA number (from the tender's LOI number), purchaser (the tender authority) and one line carrying the tender name are pre-filled.

The subtitle then reads "From <Inquiry/Tender ref> · quotation <no.>".

If the inquiry or tender already has a live order, a red banner says so ("This inquiry already has <SO>... Open that order instead — a repeat order is a new inquiry, and a quantity option is an amendment of the existing order."), an "Open <SO>" link appears, and Save is disabled. A tampered or invalid link shows an "Invalid link" page.

#### Create form

Section **Customer**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Customer (CRM organisation) | searchable dropdown | Yes | CRM organisations (up to 500), shown as "name · GSTIN" or "name · state" | Required on Save ("Pick the customer (CRM organisation) first."). Must exist in CRM. Changing the customer clears the contact |
| Contact person | dropdown | No | Contacts of the selected organisation, shown as "name (designation)" | Must belong to the selected customer |

Note on screen: the billing address and GSTIN are copied from the CRM organisation when the order is confirmed. The backend also copies them when the draft is saved, if they are empty.

Section **Contract terms** (the same fields are used on the draft view page and in amendments)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Order type | dropdown | Yes (defaults to RRV supply) | RRV supply, Spares supply, Other ("Service / AMC" exists in the backend but is hidden in this dropdown) | Must be a valid coded value |
| Customer PO no. | text | Yes for submit | Free text | Needed to submit. Must be unique per customer among live orders (checked at submit) |
| PO date | date | Yes for submit | Date picker | Needed to submit |
| PO received on | date | No | Date picker | — |
| LOA no. | text | No | Free text | — |
| LOA date | date | No | Date picker | — |
| Contract agreement ref. | text | No | Free text | — |
| Purchaser (who placed the order) | text | No | Example: "COS, Central Railway" | — |
| Paying authority | text | No | Example: "FA&CAO, Central Railway" | — |
| Price basis | dropdown | Yes (default FOR destination) | Ex-works, FOR destination, FOR dispatch station | Also decides the LD reckoning date: proof of delivery (POD) for FOR destination, dispatch date otherwise |
| Freight terms | text | No | Free text | — |
| Transit insurance | text | No | Free text | — |
| Payment terms (label) | text | No | Free text | — |
| Inspection agency | dropdown | No | "none / self" plus the Quality master list "inspection_agencies" (falls back to RITES, RDSO, Customer, Other) | — |
| Third-party inspection required before dispatch | checkbox | No | — | — |
| LD applicable | checkbox | Yes (default ticked) | — | When ticked, LD rate, period and basis are needed to submit |
| LD rate % | number (step 0.1) | When LD applies | Default from Settings (0.5) | 0 to 100 |
| Per | dropdown | When LD applies | Per week or part thereof / Per day (default from Settings) | — |
| Of | dropdown | When LD applies | Value of delayed units / Contract value (default from Settings) | — |
| Cap % (blank = no cap) | number (step 0.5) | No | Default = Settings "Standard LD cap" (10) | 0 to 100. Blank means no cap, which is a deviation. A cap above the standard is also a deviation |
| Warranty rule | dropdown | Yes for submit | From delivery, From commissioning, Whichever is earlier, Whichever is later (default from Settings) | The matching months must be filled in for the rule chosen |
| Months from delivery | number | Depends on rule | Default from Settings (30) | Not negative. Above the standard maximum is a deviation |
| Months from commissioning | number | Depends on rule | Default from Settings (24) | Not negative. Above the standard maximum is a deviation |
| Warranty wording (as in contract) | text | No | Free text | — |
| Delivery terms | multi-line text | No | Free text | — |
| Special conditions (our understanding) | multi-line text | No | Free text | — |

Currency is always INR ("Only INR orders are supported for now"). The backend model also has PBG (performance bank guarantee) fields, but the screens do not show them.

Section **Lines** (LinesEditor). Each row:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| # | auto number | — | Next free line number | Line numbers must be unique |
| Type | dropdown | Yes (default RRV) | RRV (vehicle), Spares, Service, Freight, Other | — |
| Description (as on PO) | text | Yes | Free text | Every line needs a description (checked on screen and by the backend) |
| RRV model | text | No | Free text | — |
| Customer item ref. | text | No | Free text | — |
| HSN | text | No | Free text | — |
| Qty | number | Yes (default 1) | — | Not negative. RRV lines must be whole numbers |
| Unit price ₹ | number | Yes (default 0) | — | Not negative. The order value must be above zero to submit |
| Disc % | number | No (default 0) | — | 0 to 100 |
| GST % | number | Yes (default 18) | — | 0 to 28 |
| Total | calculated | — | (Qty x Price, less discount) plus GST | Shown live |

- The "+ Add line" button adds a line. The "x" button removes a line that has not been saved yet.
- The footer shows "Order value (incl. GST)".
- Changing an RRV line's quantity automatically adds or trims vehicle rows in the delivery schedule.

Section **Delivery schedule** (ScheduleEditor). On screen: "One row per vehicle for RRV lines — each vehicle gets its own contractual date, build, LD and warranty. Spares lines are scheduled in lots."

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Line | label | — | "L<n> · vehicle <k>" | Must point to a line on the order |
| Qty | number (fixed at 1 for RRV) | Yes | — | RRV rows must be exactly 1. All rows for a line must add up to the line quantity (checked at submit) |
| Consignee | text | No | Defaults to the customer name | — |
| Consignee address | text | No | Free text | — |
| Consignee GSTIN | text (upper-cased) | No | Free text | — |
| Contractual delivery date | date | Yes for submit | Date picker | Every row needs a date to submit. Also sets the current delivery date |

- For non-RRV lines there is a "+ Lot for line N" button that adds a lot row. These rows can be removed with "x".
- Empty text: "No delivery rows yet — add an RRV line and its vehicles appear here."

Section **Billing plan** (BillingPlanEditor). Default rows: Advance 20%, On delivery (POD) 80%.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| # | auto | — | — | — |
| Milestone | dropdown | Yes | Advance, Drawing approval, Inspection clearance, On dispatch, On delivery (POD), On commissioning, Retention release, Other | Must be a valid type |
| Description | text | No | Free text | — |
| % | number | Yes | — | Above 0 and at most 100, with no more than 3 decimals. All rows must total exactly 100% to submit |
| Amount | calculated | — | Grand total x % | Shown live. The backend puts any rounding difference on the last open milestone |
| Per vehicle | checkbox | No | — | — |
| Credit days | number | No | — | — |

- "+ Add milestone" adds a row pre-filled with the % still unscheduled.
- The footer shows "Total X%" in green with a tick when it is 100%. Otherwise it is red, with how much is not scheduled or how much is too much.

Section **Customer PO / LOA document**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| File(s) | file, multiple | Yes for submit (not for saving the draft) | .pdf .jpg .jpeg .png .doc .docx | Uploaded after the order is created, as document type "Customer PO". If the upload fails, the draft is still created |

Button **Save draft** creates the order with status Draft, owned by and attributed to the current user, then opens the order view page. The backend rejects a second live order for the same inquiry or tender (409).

### Sales Order view page (/dashboard/sales/orders/[ref])

The URL uses a signed record reference. An edited or invalid link shows an "Invalid link" page with "Back to sales orders". The page can open on a given tab with ?tab=.

#### View page

**Header:** display number with a status pill. Subtitle: customer name, "PO <no.>", grand total incl. GST, and "amendment N" if the order has been amended. "Back" goes to the orders list.

**Header action buttons.** Each button appears only when the backend permission flag ("can") allows it:

| Button | Shown when | What it does |
|---|---|---|
| Submit for approval | Status Draft and the user has Orders "submit" | Runs the submit checks and sends the order to the approval engine. Status becomes Pending approval |
| Approve | Legacy-chain orders only: pending, the user holds the next level (or is admin), has Orders "approve" and is not the submitter | Opens a dialog with an optional comment (required when an admin stands in for the approver). Records the approval. The last level confirms the order |
| Return | Same as Approve | Opens a dialog with a required reason. Sends the order back to Draft with the comment |
| Reject | Same as Approve | Opens a dialog with a required reason. Cancels the order and all its rows |
| Mark OA issued / Re-issue OA | Order has an SO number, is not Cancelled, and the user has Orders "edit" | Stamps the date and person who issued the order acknowledgement (OA) |
| Hold | Status Confirmed, In execution or Partially delivered, and the user has Orders "edit" | Opens a dialog with a required reason. Status becomes On hold and the previous status is remembered |
| Resume | Status On hold and the user has Orders "edit" | Returns the order to its previous status and re-derives progress |
| Short-close | Status In execution or Partially delivered, the user is the Sales Head (or admin) and has Orders "approve" | Opens a dialog with a required reason (quote the customer letter). Blocked if any open vehicle's build has started. Open rows are cancelled and builds that have not started are unlinked |
| Close | Status Delivered, the user is the Sales Head (or admin) and has Orders "approve" | Opens a dialog with a required reason. Status becomes Closed |
| Cancel order | Draft or Pending approval: the user is the creator, submitter or sales owner (or admin) and has Orders "cancel". Confirmed: the user is the Sales Head and has Orders "approve" and "cancel" | Opens a dialog with a required reason. All rows are cancelled. For a confirmed order, linked builds that have not started are unlinked and production planners are notified. A pending approval request is withdrawn |
| Delete draft | Status Draft, the user has Orders "delete" and is the creator (or admin) | Opens a confirmation. The draft is soft-deleted. Submitted orders are cancelled, never deleted |

**Status stepper:** 1. Draft, 2. Pending approval, 3. Confirmed, 4. In execution, 5. Partially delivered, 6. Delivered, 7. Closed. Steps up to the current status are highlighted. On hold is shown at the Confirmed step.

**Banners:**

- Pending approval (engine): "Waiting for <stage> (<approver names>). Decide below, or in My Approvals."
- Pending approval (legacy): "Waiting for the <level> (...). Approval chain up to <level>".
- Either pending banner also lists any non-standard terms (deviation flags). If the customer's open orders exceed the CRM credit limit, it adds a red "Credit check" line.
- While pending on the engine (and not on the Approvals tab), the shared **ApprovalPanel** appears so approvers can approve, return or reject.
- "Returned for changes: <comment>" appears on a draft that was returned.
- "An amendment is open — see the Amendments tab." appears while an amendment is in draft or pending.
- Success and error messages appear under the stepper.

**Tabs:** Overview, Lines, Delivery Schedule, Billing Plan, Amendments, Documents, Approvals, Timeline.

**Overview tab, section "Order"**

| Field | Meaning |
|---|---|
| Customer | Customer name (copied from CRM) |
| GSTIN | Customer GSTIN (copied from CRM) |
| Contact | Contact person name |
| Source | "Inquiry <ref>", "Tender <ref>" or "Direct order", plus the quotation number |
| Order type | Order type label |
| Billing address | Copied from the CRM organisation address, city, state and PIN |
| Value | "Taxable + GST = Grand total" |
| Units delivered | "X of Y" |
| Sales owner | Sales owner (defaults to the creator) |
| Confirmed | Confirmation date and the person who confirmed |
| OA issued | Date the OA was marked issued |
| Hold reason | Shown only while On hold |
| Cancelled | Cancel reason (also lists unlinked builds and closed follow-ups) |
| Short-closed | Short-close reason |

**Overview tab, section "Contract terms".** In Draft, for a user with Orders "edit", this section is the editable terms form with a **Save terms** button. Otherwise it is read-only:

| Field | Meaning |
|---|---|
| Customer PO | PO number and PO date |
| LOA | LOA number and date |
| Purchaser | Who placed the order |
| Paying authority | Who pays |
| Price basis | Ex-works / FOR destination / FOR dispatch station |
| Freight / insurance | Freight terms / transit insurance |
| Inspection | Agency (upper case), plus "(TPI required)" |
| LD | "<rate>% <period> of <basis>, cap X%" (or "no cap"), or "Not applicable" |
| Warranty | "N m from delivery / N m from commissioning — <rule>" |
| Delivery terms | Text |
| Special conditions | Text |

**Lines tab.** In Draft with "edit", this is the editable LinesEditor with **Save lines**. Saving regenerates vehicle rows for RRV lines that have none. Otherwise it is a read-only table:

| Column | What it shows |
|---|---|
| # | Line number |
| Type | Line type |
| Description | Description |
| Model | RRV model |
| Cust. ref. | Customer item reference |
| Qty | Quantity and unit of measure |
| Unit price | ₹ |
| Taxable | Taxable amount |
| GST | GST amount (rate %) |
| Total | Line total |
| Delivered | Quantity delivered / quantity scheduled |

**Delivery Schedule tab**

- In Draft: the editable ScheduleEditor with **Save schedule** and a "Match vehicle rows to line quantities" button (both need "edit"). Without "edit" it is read-only.
- In Pending approval: a read-only schedule.
- After confirmation: the **DeliveryPanel**, which has two sections.

Section "Vehicles / lots". The header shows "LD accrued ₹X · forecast ₹Y" for the order.

| Column | What it shows |
|---|---|
| Vehicle | "L<line> / <sequence>", plus the quantity if it is not 1 |
| Consignee | Consignee name, plus contact name and phone |
| Contract date | Contractual delivery date |
| Current date | Current delivery date (bold when it differs from the contract date). Shows "LD waived" if waived |
| Committed | Committed date, taken from the linked build's target handover date |
| Build | Build number as a link to the Production RRV build. Otherwise, for RRV rows when the user can link builds, a "Link build" button opens a searchable picker of builds not yet tied to an order ("build no. · model · status") with "Link" and "x". Otherwise a dash |
| Stage | Current production stage of the build ("Done" when completed or handed over) |
| Status | Row status pill |
| Risk | Overdue / At risk pill |
| LD accrued | ₹ amount (number of periods) |
| LD forecast | ₹ amount (number of periods) |
| (action) | "Unlink", shown only when a build is linked, the user can link builds and the build's status is still "planned". It asks for confirmation: "The build stays in Production as a planned build without an order" |

- Notes on screen: the number of cancelled rows kept for history. "LD is computed per vehicle (rate x weeks late, "or part thereof", capped) — shown, never posted. The committed date comes from the build's target handover date."
- Linking a build copies the order's customer, PO, SO number and line onto the build. It also sets the build's target handover date to the row's current delivery date if the build has none. A build can sit on only one live delivery row.

Section "Delivery-period (DP) extensions".

- The "+ Request DP extension" button needs Delivery "create" and an order status of Confirmed, In execution, Partially delivered or On hold. It opens an inline form:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Vehicles | checkboxes | Yes | Undelivered rows, shown as "L<line>/<seq> (due date)" | At least one. Only undelivered rows |
| New date requested | date | Yes | Date picker | Must be after each chosen row's current date |
| Reason category | dropdown | Yes | Customer cause (late drawing approval / inspection), Force majeure, Our cause | — |
| Reason | text | Yes | Free text | Must not be blank |
| Our letter ref. | text | No | Free text | Stored as the letter reference |

- Buttons: "Record request" saves the request with status Requested. "Cancel" closes the form.

The extensions table:

| Column | What it shows |
|---|---|
| Vehicles | "Line N / seq" list |
| Requested | Requested new date |
| Reason | Category: reason |
| Status | Requested (amber), Granted (green), Refused by customer (red), or Closed (order ended) (grey) |
| Granted | "Granted date with/without LD · letter ref.", or the decision remarks |
| (actions) | "Granted" and "Refused" buttons, shown when the status is Requested and the user has Delivery "approve" |

- **Granted** opens the inline form "Record the customer's grant":

| Field | Type | Required | Rules |
|---|---|---|---|
| Granted date | date | Yes | Defaults to the requested date. Cannot be before any row's current date |
| Customer letter ref. | text | Yes | Must not be blank |
| Letter date | date | No | — |
| Granted with LD | checkbox | No | Default is unticked |

  "Save grant" moves the current delivery date of the rows that are still undelivered. "Without LD" waives LD on those rows. The requester and the sales owner get a bell notification.
- **Refused** opens a dialog with a required reply ("Quote the customer's reply."). The status becomes Refused and the requester and sales owner get a bell notification.
- A request cannot be decided once the order is Cancelled, Short-closed or Closed.

**Billing Plan tab.** In Draft with "edit", this is the editable BillingPlanEditor with **Save billing plan**. Otherwise it is read-only, with this note: "Milestone status (due / invoiced / settled) is tracked from Phase 2, when invoicing is handed to Finance", followed by each milestone and its status. Billing statuses: not due, due, proforma issued, invoice requested, invoiced, settled, cancelled. Milestones past "due" cannot be changed or removed.

**Amendments tab (AmendmentPanel)**

- **+ New amendment** appears when the order is Confirmed, In execution, Partially delivered or On hold, the user has Orders "create", and no amendment is in draft or pending. It asks for a required reason ("Quote the customer's amendment letter..."). The new draft amendment is numbered with the order's amendment count + 1 and starts as a full copy of the order.
- **Draft amendment** section: "Amendment N (draft) — reason". It contains the editable Terms, Lines, Delivery schedule and Billing plan (the same editors as the create form) and a changes table. Buttons:
  - **Save changes** stores the proposal and recalculates the diff, the value change and the deviations.
  - **Submit for approval** saves, then submits. It is blocked if nothing has changed, if the proposal fails the line, schedule or billing checks, if it removes a vehicle whose build has started, or if no approver chain can be staffed.
  - **Cancel** asks for confirmation; the order stays as it is.
  - Rules: lines cannot be deleted (set the quantity to 0 instead). Removing a delivery row cancels it and unlinks a build that has not started. Dispatched or delivered rows cannot be removed. Only the amendable header fields can change: the customer, source and numbering are fixed.
- **Other amendments**, newest first. Each shows "Amendment N — reason", the customer ref., the value change, "needs/waiting for <level or stage>", any non-standard terms, and a status pill (Draft, Pending approval, Approved, Rejected, Cancelled). They can show:
  - Approve and Reject buttons, for legacy-chain pending amendments, shown to users other than the submitter. Reject needs a reason.
  - "Cancel amendment" while pending. The backend allows only the creator, the submitter or an admin.
  - The rejection reason.
  - The changes table.
  - The ApprovalPanel, for engine-routed amendments.
  - A line listing past decisions.
- **Changes table:**

| Column | What it shows |
|---|---|
| Where | Header field, "Line N", "Line N delivery K" or "Milestone K (type)" |
| Field | The changed field |
| Old | Old value (red) |
| New | New value (green), or "added" / "removed" |

- Final approval applies the amendment to the order in one step: the header, lines, schedule and billing are updated, totals recalculated, and the order's amendment number goes up by one. Bell notifications go out. Production planners are told about any builds that were released.
- Empty text: "No amendments. Amendments are raised once the order is confirmed."

**Documents tab**

- **Order acknowledgement**, shown once the order has an SO number. The heading adds "— amendment N" for amended orders.
  - "Download PDF" opens the OA PDF. This needs Orders "print".
  - The ManagedDocumentPanel provides the managed Word document ("Save & Edit in Word"). Only users with "edit" can change it, and the document revision equals the amendment number.
- **Attachments**:

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Document type | dropdown | Yes (default Customer PO) | Customer PO, LOA, Amendment letter, DP extension letter, Proof of delivery, Inspection certificate, Bank guarantee, Other | — |
| File(s) | file, multiple | Yes | .pdf .jpg .jpeg .png .doc .docx .xls .xlsx | Stored in SharePoint under Sales-Orders. Needs Orders "view" and "edit" |

  The "Upload" button uploads the files. The table columns are File (click to open), Type, Uploaded by, On, and a "Delete" button. Delete rules (backend): only the uploader or an admin can delete. A Customer PO or LOA file cannot be deleted once the order has left Draft. Amendment letters cannot be deleted once the amendment is approved. DP extension letters cannot be deleted once the extension is decided.
  - Empty text: "No attachments. The customer PO (or LOA) is required before submitting."

**Approvals tab**

- For engine-routed orders, the ApprovalPanel shows the engine's steps.
- Below it, the "Approval history" table (titled "Earlier decisions (before Approval Workflows)" for engine orders that also have older decisions) has these columns: Round, Level, Decision (approved / returned / rejected pill), By ("(admin stand-in)" when relevant), When, Comment.
- Note on screen: "Who approves sales orders, and above which order value, is set in Organization › Approval Workflows (Sales order)."

**Timeline tab.** A list of every audit-log entry for the order, oldest first. Each entry shows "date-time · user: summary". The text "system" is used when no user is recorded.

#### Edit

- **Draft only.** The terms, lines, delivery schedule and billing plan can be edited and saved separately (Save terms, Save lines, Save schedule, Save billing plan). This needs Orders "edit". Changing the customer clears the copied GSTIN, state, billing address, place of supply and (unless a new one is given) the contact.
- **From Pending approval onward, everything is locked.** After confirmation the contract changes only through an amendment. The backend returns "After confirmation the contract changes only through an amendment."
- **After confirmation**, three things can still change without an amendment: build links (Delivery "edit"), DP extensions (Delivery "create" / "approve"), and OA issue. The backend also has an endpoint for consignee contact name, phone and committed date (Delivery "edit"; the committed date is locked when a build is linked), but no screen exposes it.
- Saving recalculates the line amounts (gross, discount, taxable, GST, total), the order totals and the billing amounts.

#### Statuses & workflow

Order statuses: Draft, Pending approval, Confirmed, In execution, Partially delivered, Delivered, Closed, On hold, Cancelled, Short-closed.

1. **Draft to Pending approval** (Submit; needs Orders "submit"). The submit checks are:
   - The customer exists and has a GSTIN or a state in CRM.
   - The PO number and PO date are filled in.
   - A Customer PO or LOA file is attached.
   - There is at least one line.
   - Every RRV or spares line is fully scheduled, with dates, and each RRV row is 1 vehicle.
   - The billing plan totals 100%.
   - If LD applies, the LD rate, period and basis are filled in.
   - A warranty rule is chosen, with its months filled in.
   - The order value is above zero.
   - The PO number is not already on another live order of the same customer.
   - The approval chain can be staffed with different people.

   On submit, the deviation flags are computed (LD uncapped, LD cap above standard, warranty above standard, advance below minimum). The approval round goes up by one and the order is submitted to the central approval engine (transaction "Sales order").
2. **Approval chain.** These are the default stages, which can be changed in Organization › Approval Workflows. The amount is the order grand total:
   - Sales Head: always.
   - Director: when the amount is above ₹50 lakh.
   - Director (non-standard terms): when there are deviations and the amount is ₹50 lakh or less.
   - Partner: when the amount is above ₹2 crore.
   - Partner (non-standard terms): when there are deviations and the amount is ₹2 crore or less.

   Each stage must be a different person. The creator, submitter and sales owner cannot approve (four-eyes rule). Approvers must have Orders "approve". The Sales Head is the Settings "Sales Head" user, or else the head of the Sales / BD department. Directors and Partners are users flagged as such who have the Sales app. If the Settings credit check is set to "block" and the customer's open orders exceed their CRM credit limit, approval is refused.
3. **Final approval to Confirmed:**
   - The SO number is issued from the Accounts financial-year series, in the form SO/<FY>/<NNNN>.
   - The customer data is copied onto the order.
   - The status becomes Confirmed and the progress is re-derived.
   - The source CRM inquiry is set to "Closed - Ordered" / "Order Received", or the tender to "Closed – Ordered" / "Awarded / Lost".
   - Notifications are sent (see section 6).
4. **Return** sends the order back to Draft with the comment. **Reject** cancels the order: all rows are cancelled, the open amendment is cancelled and pending DP extensions are closed.
5. **Execution statuses are derived automatically** from the delivery rows:
   - In execution: any row is in production, ready or dispatched.
   - Partially delivered: some rows are delivered or commissioned.
   - Delivered: all live rows are delivered or commissioned.
6. **On hold** can be set from Confirmed, In execution or Partially delivered. Resume returns the order to the previous status.
7. **Cancelled** is possible from Draft, Pending approval or Confirmed. An order in execution is short-closed instead.
8. **Short-closed** is possible from In execution or Partially delivered (Sales Head). It is blocked if any open build has started.
9. **Closed** is possible from Delivered (Sales Head).

When an order is cancelled, rejected, short-closed or closed, its open amendment is cancelled and its pending DP extensions are closed as "Closed (order ended)".

Delivery row statuses are derived and never set by hand:

| Row status | Meaning |
|---|---|
| Open (no build) | No build linked |
| Build planned | Linked build has status "planned" |
| In production | Linked build is in progress or on hold |
| Ready | Linked build is in any other active status |
| Dispatched | Has a dispatch date |
| Delivered | Has a delivery date |
| Commissioned | Has a commissioning date |
| Cancelled | Cancelled |

No code outside Sales currently writes the dispatch, delivery or commissioning dates.

Risk, for undelivered rows on executing orders:

- **Overdue**: today is past the current delivery date.
- **At risk**: the committed date is after the current date, or the row is due within the at-risk window (default 14 days) and its build has not reached Final Inspection.

LD per row:

- Rate % x periods late x unit taxable value. Weeks are counted "or part thereof", so 8 days late is 2 weeks. Days are counted as days.
- Lateness is measured from the current delivery date to the POD date (FOR destination) or the dispatch date (other price bases). For open rows, today is used.
- The amount is capped at Cap % of the delayed value, or of the contract value. With the contract-value basis, the cap is shared across the whole order.
- A grant "without LD" waives LD on that row.
- Forecast LD uses the committed date.

Amendment statuses: Draft, Pending approval, Approved (applied to the order), Rejected, Cancelled. Amendments use the same default stage chain (transaction "Sales order amendment"). There the amount is the absolute value change, and the deviation flags of the proposal decide the non-standard-terms stages. A returned amendment goes back to Draft.

DP extension statuses: Requested, Granted, Refused. "Closed (order ended)" is a refusal recorded automatically when the order ended.

### Amendment link (/dashboard/sales/amendments/[ref])

This is not a screen of its own. It is the link target used by approval notifications and My Approvals. It loads the amendment and redirects to its order's Amendments tab. While loading it shows "Opening the amendment…". An error shows a banner, and an invalid link shows "Invalid link".

### Delivery Schedule (/dashboard/sales/delivery)

Title "Delivery Schedule". Subtitle "Every open vehicle across confirmed orders, by due month — with its build stage, risk and LD."

#### List view

Filters:

| Filter | Type | Options |
|---|---|---|
| Risk | dropdown | All vehicles, At risk or overdue, At risk, Overdue |
| Stage | dropdown | All stages, Open (no build), Build planned, In production, Ready, Dispatched |
| Month | text, YYYY-MM | Current delivery date in that month (applied once the value is a full YYYY-MM) |

The board shows the undelivered rows of orders that are Confirmed, In execution, Partially delivered or On hold, within the user's scope. It is sorted by current delivery date, then order, then sequence, and grouped under month header rows ("YYYY-MM · N vehicle(s)", or "Undated").

| Column | What it shows |
|---|---|
| Due | Current delivery date |
| Order | Order display number |
| Customer | Customer name |
| Vehicle | "L<line>/<seq>" plus the RRV model |
| Consignee | Consignee name |
| Build | Build number, or "not linked" |
| Stage | Build's current production stage |
| Status | Row status pill |
| Risk | Overdue / At risk pill |
| LD accrued | ₹ |
| LD forecast | ₹ |

- Row action: clicking a row opens the order on its Delivery Schedule tab.
- Empty text: "No open vehicles match."

Section **DP extensions waiting for the customer** lists all requests with status Requested, within scope.

| Column | What it shows |
|---|---|
| Order | Order display number |
| Customer | Customer name |
| Vehicles | "Line N / seq" list |
| Requested date | Requested new date |
| Reason | Category: reason |

- Clicking a row opens the order's Delivery Schedule tab.
- Empty text: "None open. Request an extension from the order's Delivery Schedule tab."
- No create, edit or delete actions on this page. Extensions are raised and decided on the order.

### Sales Reports (/dashboard/sales/reports)

Title "Sales Reports". Subtitle "Order book, backlog by delivery month and LD exposure (computed, not posted)." All three reports are read-only and need Reports "view".

#### List view: Order book

Open orders (Confirmed, In execution, Partially delivered, On hold), sorted by SO number.

| Column | What it shows |
|---|---|
| Order | SO number |
| Customer | Customer name |
| Models | Distinct RRV models on the lines |
| Confirmed | Month of confirmation (YYYY-MM) |
| Taxable value | Taxable total |
| Delivered value | Sum of unit taxable value of delivered or commissioned rows |
| Balance | Taxable value minus delivered value |
| Units | Delivered / total |
| Next due | Earliest open current delivery date |
| Status | Status pill |

- Clicking a row opens the order.
- Empty text: "No open orders."

#### List view: Backlog by delivery month

Undelivered rows of executing orders, bucketed by the month of their current delivery date ("undated" when there is none).

| Column | What it shows |
|---|---|
| Month | YYYY-MM |
| Units | Quantity |
| Value | Sum of unit taxable value |
| At risk | Count of at-risk rows (amber when above zero) |
| Overdue | Count of overdue rows (red when above zero) |
| LD forecast | Sum of forecast LD |

- Empty text: "No undelivered vehicles."
- The rows cannot be clicked.

#### List view: LD exposure

One row per order with open vehicles, sorted by accrued plus forecast LD, highest first.

| Column | What it shows |
|---|---|
| Order | SO / display number |
| Customer | Customer name |
| Overdue | Overdue vehicles |
| At risk | At-risk vehicles |
| Accrued | LD accrued (capped at the remaining contract-value cap) |
| Forecast | LD forecast (capped the same way) |

- Clicking a row opens the order on its Delivery Schedule tab.
- Empty text: "No exposure."

## 4. Settings / Masters

Route /dashboard/sales/settings, title "Sales settings". It uses the shared module-settings screen: settings are grouped, each has a "Reset to default", and there is a Save bar. Needs the Settings tab.

| Group | Setting | Type | Default | What it controls |
|---|---|---|---|---|
| Order approval | Sales Head | user | blank | Approves every sales order (the "Sales Head" stage) and handles cancelling a confirmed order, short-close and close. If blank, the head of the Sales / BD department is used |
| Order approval | Credit check | select: Off / Warn the approver / Block approval | Warn | Compares the customer's open order value with the CRM credit limit. "Block" stops final approval |
| Standard terms | Standard LD cap (%) | decimal 0–100 | 10 | A cap above this, or no cap at all, is a deviation. Also the default cap on new orders |
| Standard terms | Standard warranty, max months | int 0–240 | 30 | Warranty months above this are a deviation |
| Standard terms | Minimum advance (%) | decimal 0–100 | 0 (check off) | An advance milestone total below this is a deviation |
| New order defaults | Default LD rate (%) | decimal | 0.5 | Pre-fills the LD rate |
| New order defaults | Default LD period | select | Per week or part thereof | Pre-fills the LD period |
| New order defaults | Default LD basis | select | Value of the delayed units | Pre-fills the LD basis |
| New order defaults | Default warranty from delivery (months) | int | 30 | Pre-fills the months |
| New order defaults | Default warranty from commissioning (months) | int | 24 | Pre-fills the months |
| New order defaults | Default warranty rule | select | Whichever is earlier | Pre-fills the rule |
| Delivery tracking | At-risk warning window (days) | int 0–365 | 14 | A vehicle due within this many days whose build has not reached Final Inspection is flagged at risk |

Other masters used by Sales and kept elsewhere:

- The approval stages and value limits: Organization › Approval Workflows ("Sales order", "Sales order amendment"). Old Sales amount-limit settings are moved there automatically, once.
- Inspection agencies: the Quality master list "inspection_agencies".
- Customers and contacts: CRM organisations.
- The SO number series: the Accounts FY number series "SO".
- Director and Partner flags: user records. Partners are set in Company Info › Partners.

## 5. Permissions

Module access: the "sales" app. Every page calls useRequireApp('sales') and every endpoint requires Sales app access. Tab permission keys (sales:<tab>:<action>):

| Tab key | Actions | What they gate |
|---|---|---|
| dashboard | view | Dashboard page and data |
| orders | view, create, edit, delete, approve, submit, cancel (plus the standard workflow actions) | view: list, view page, timeline, amendments list, OA. create: new order, prefill, new amendment. edit: draft edits, Hold/Resume, Mark OA issued, edit the managed OA Word document, edit amendment drafts, upload/delete order attachments. submit: submit an order or amendment. approve: approve/return/reject (legacy), engine approver eligibility, short-close, close, cancel a confirmed order. cancel: cancel an order or amendment. delete: delete a draft. print: OA PDF / Word |
| delivery | view, create, edit, approve, print | view: Delivery board, extensions lists, DP-extension letters. create: request a DP extension. edit: link/unlink builds, update a schedule row, upload/delete DP-extension letters. approve: record a grant or refusal |
| reports | report actions (view etc.) | Reports page and data |
| settings | settings actions | Sales settings page |

Role and flag rules on top of permissions:

- **Sales Head** (the Settings user, else the Sales/BD department head; admins count as Sales Head): needed, together with Orders "approve", for short-close, close and cancelling a confirmed order.
- **Approvers:** Sales Head, Directors (is_director) and Partners (is_partner) who have the Sales app and Orders "approve". The creator, submitter and sales owner are excluded, and each stage must be a different person. Admins can stand in on legacy-chain orders but must give a comment.
- **Cancelling before confirmation:** only the creator, submitter, sales owner or an admin.
- **Deleting a draft:** the creator or an admin. Deleting an attachment: the uploader or an admin. Cancelling an amendment: its creator, its submitter or an admin.
- **Data scope** (the role's data access): own = orders the user owns (sales owner) or created; assigned = also orders they submitted; or department / plant / organization scope. At any scope, users also see orders they approve or approved, and orders whose amendment they own or approve. Pickers and the read-only chips used by CRM and Production are not scoped.

## 6. Documents, Notifications & Integrations

### Documents

- **Order Acknowledgement (OA):** a managed Word document of record (entity sales_order_ack). "Save & Edit in Word" is the primary action through the ManagedDocumentPanel, and "Download PDF" is secondary. The PDF uses the Word document once one exists. It is available only after confirmation (it needs the SO number), and its revision equals the amendment number. It is titled "ORDER ACKNOWLEDGEMENT" (plus "— AMENDMENT N") and contains:
  - Customer, PO, GSTIN, LOA, billing address, contract ref., purchaser, paying authority, price basis, freight / insurance, order and taxable value.
  - An Items table, a Delivery schedule table and a Billing / payment milestones table.
  - An LD, warranty and inspection statement, and remarks (delivery terms, special conditions, warranty wording).
  - A request to report differences within 7 days.
  - Signatures: "For Premnath Rail" (the confirming user) and "Acknowledged by customer".

  It is stored in SharePoint under Sales-Orders/<SO no.>, with filename OA-<SO no.>[-A<n>].
- **Attachments** (Customer PO, LOA, amendment letters, DP-extension letters, POD, inspection certificate, bank guarantee, other) are stored in SharePoint under Sales-Orders. If SharePoint is not configured, uploading and opening fail with an explanatory message.

### Notifications

All notifications go to the bell unless Teams is mentioned.

- **Approval needed** (Teams and bell): sent through the approval engine to the current stage's approvers. On the legacy chain, the next level's eligible approvers are notified directly.
- **Order confirmed** (bell): sent to the creator, submitter and sales owner, and to production planners ("New order <SO> — plan the builds"). A broadcast also goes to users of the Accounts app.
- **Returned / Rejected** (bell): sent to the submitter and creator.
- **Cancelled confirmed order with builds released** (bell): sent to production planners.
- **DP extension granted / refused** (bell): sent to the requester and the sales owner.
- **Amendment approved** (bell): sent to the creator, submitter and sales owner. If builds were released, production planners are notified as well. **Amendment rejected** (bell): sent to the submitter and creator.
- **Daily job at 06:30 IST** (Teams and bell, at most once per user, order, type and day). It re-derives row status, LD and risk for all executing orders, then sends:
  - "delivery at risk" when a vehicle newly becomes at risk, to the sales owner and the Sales Head.
  - "N vehicle(s) overdue" with the accrued LD, to the same people.
  - A reminder to the current approvers for orders that have been pending approval for more than 2 days.

### Integrations

- **CRM:**
  - Inquiry and tender pages show a "Create Sales Order" button, which opens the pre-filled form. Once an order exists they show a chip linking to it.
  - Confirmation closes the inquiry or tender as ordered and writes a CRM stage log entry.
  - Customers, contacts, credit limits and quotations come from CRM.
  - Only one live order is allowed per inquiry or tender.
- **Production:**
  - Each RRV vehicle row links to one Production RRV build. The build gets the SO, line, customer and PO, and its target handover date becomes the row's committed date.
  - The build's status and stage drive the row status, the risk and the order's execution status.
  - Production's build header reads the linked SO, due date and LD rate.
  - Cancelling, short-closing or amending an order unlinks builds that have not started, and planners are told.
- **Quality:** the inspection agency list comes from Quality masters, and the OA uses the Quality document renderer.
- **Organization:** the central approval engine (Approval Workflows, My Approvals) and the branch on the order.
- **Accounts / Finance:** the SO number comes from the Accounts FY series, and confirmation is broadcast to Accounts users. Billing-milestone invoicing is planned for a later phase and is not wired yet.
- **ERP Projects:** the projects view reads which sales orders are linked through delivery rows.
- **Dispatch / Commissioning:** the delivery rows have dispatch, delivery and commissioning dates and warranty start and end fields, but in the current code nothing outside Sales fills them in.
