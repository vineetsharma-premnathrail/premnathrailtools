# Store manual notes C - Outward movements and Store connections

Researched 2026-11-02 from CURRENT page code and backend (not from tour configs). Everything below was read in code; tour configs are only compared in section 7.
Paths: pages `frontend/src/app/dashboard/store/...`, components `frontend/src/components/store/...`, backend `backend/app/modules/store/...`.

Conventions used in this file: "Free stock" = the On Hand (Free) column. "Available" = On Hand (Free) minus Reserved. Quality, Blocked and With Vendor are separate buckets that issue / transfer / reservation never touch.

---------------------------------------------------------------------------------------------------

## 1. Screen map

Store top bar (StoreNav): tabs Inventory | Inward | Outward, then a Settings gear and the bell. Outward group = pills Issues, Job Work, Transfers, Reservations. There is no Store dashboard/landing page: opening Store lands on Inventory > Item Master (`/dashboard/store`).

| Screen | URL path | Purpose | Permission (module store) |
|---|---|---|---|
| Outward > Issues (list) | /dashboard/store/issues | List of all material issues (newest first from server). Row click opens the issue. | tab `issues` view (backend also lets `returns` create read it, because New Return picks an issue) |
| New Material Issue | /dashboard/store/issues/new | Create an issue. Button "+ New Issue" on the list. | `issues` create |
| Issue detail | /dashboard/store/issues/{signed ref} | Read-only record + items (+ job-work challan Word doc for job-work type). | `issues` view |
| Outward > Job Work | /dashboard/store/job-work | Challans at vendors, Stock with Vendors, Job Work Receipts, ITC-04. Button "+ New Challan". | feature `issues.job_work` view (page), create (new challan), export (ITC-04 Excel) |
| New Job Work Challan | /dashboard/store/job-work/new | Same form as New Material Issue with the type fixed to Job Work plus "Items to receive back". | feature `issues.job_work` create (server also checks it when the type is job_work) |
| Receive processed items (popup on Job Work) | same page | Post the processed items that came back. | feature `issues.job_work_receipts` create (view to see the tab) |
| Return as-is (popup on Job Work) | same page | Send unprocessed material back into the store (creates a Material Return). | tab `returns` create |
| Outward > Transfers (list) | /dashboard/store/transfers | Transfers with status chips. "+ New Transfer". | tab `transfers` view / create |
| New Stock Transfer | /dashboard/store/transfers/new | Raise a transfer (button "Submit for Approval"). | `transfers` create |
| Transfer detail | /dashboard/store/transfers/{signed ref} | Progress bar, approval panel, Dispatch, Confirm Receipt, Cancel Transfer, Stock Transfer Note (Word + PDF). | view = `transfers` view; Dispatch = feature `transfers.dispatch` edit; Confirm Receipt = feature `transfers.receive` edit; Cancel = person who raised it, or `transfers` delete |
| Outward > Reservations | /dashboard/store/reservations | List + "+ New Reservation" popup; row actions Fulfill / Cancel. Filter buttons "All reservations" / "Project stock". | tab `reservations` view / create; Fulfill and Cancel need `reservations` edit |
| Store > Project work | /dashboard/store/project-work | Retired. Redirects to /dashboard/ongoing-projects, which itself redirects to Project Management > My Tasks (/dashboard/projects/my-tasks). Not a Store screen any more. | (tab `project_work` still exists in the Role editor, "Ongoing Projects") |
| Settings > Issue Types | /dashboard/store/settings/issue-types | List of the 11 fixed issue types; only renaming. | tab `issue_types` (view/edit) |
| Settings > Issue Rules | /dashboard/store/settings/issue-rules | Retired (2026-10-12): redirects to /dashboard/store/settings. What each type asks for is now fixed in code. | (tab `issue_rules` still in Role editor) |
| Inventory > Stock | /dashboard/store/stock | Where you see On Hand (Free), Reserved, Available, Quality, Blocked, With Vendor per item and store. | `stock` view |

Related pages used by outward flows (other notes cover them): Inward > Returns (/dashboard/store/returns, reverses an issue), Inventory > Bins, Serial Nos., Batches, Movements.

Plant scope: every outward screen is limited by the user's Store data scope. A user without access to a store gets: "You can't see or post stock for store {name} - {reason} (your Store data access is '{level}'). ..." (plant_access.py).

---------------------------------------------------------------------------------------------------

## 2. Documents - lifecycle and step-by-step

### 2.1 Material Issue (number MI-YYYY-NNNN, e.g. MI-2026-0001)

**Purpose.** Hand material out of a store: production, maintenance, project/site, office use, rework, testing, job work, scrap, customer sample, dispatch of finished goods, spares to a service site.

**Lifecycle.** There is NO status and NO approval (Permission matrix says: "Issues post at once - no approval"). Click "Issue Material" -> the stock leaves the store immediately and the issue is final. There is no Edit, no Delete, no Cancel on an issue (the matrix lists edit/delete for Issues but there are no routes using them; the detail page has only "<- Back"). To undo or take back material use Inward > Returns "Against a Material Issue" (a return, which may need approval - other notes). A scrap/disposal issue is a write-off and cannot be undone except by a stock adjustment.

**Issue date.** Not on the form; always today. (API refuses a future date: "Issue date YYYY-MM-DD is in the future - stock can only be issued for today or earlier.")

**Step by step (page "New Material Issue", subtitle "Stock leaving the store - pick the issue type; its fields follow.")**
1. Outward > Issues > "+ New Issue". Needs Issues > Create.
2. Section "Issue Details":
   - **Store** (required, dropdown of the user's stores). Picking a store loads live stock (refreshes every 30 s; button "Refresh stock"; text "Live stock of {store} - updated {time}").
   - **Issue Type** (required). 10 choices on this form (Job Work is not offered here; it is started from Job Work > "+ New Challan"). Picking a type shows its own fields (section 3). Changing the type clears the typed values.
3. Section "Remarks" (right side): textarea. Optional, except for Scrap (required, labelled "Reason for scrapping / disposal"). Store Managers (flag on user, store manager, or admin) also see "Reason for using project stock (Store Manager)" - only fill it when stock held for another project must be taken (section 3.5).
4. Section "Items": table columns # | Item | Quantity | Available in store | Batch / bin / serial | Remarks | (trash). Buttons "Refresh stock", "Import from Excel", "Download template", "Add Item".
   - **Item**: search by item code or name (Item Master only).
   - **Quantity**: number > 0. The placeholder shows the item's UOM.
   - **Available in store**: live "{n} {uom} available" (green) or red. Also shows "Not in stock", "Short by {x}" (adds "(all lines of this item)" when the same item is on several lines), "{on hand} on hand, {reserved} reserved", "{n} held in Quality / Blocked".
   - **Batch / bin / serial**: see 3.4.
   - Remarks per line: optional.
   - "Import from Excel" reads item_code, quantity, batch_number, remarks (.xlsx/.xlsm/.csv, max 1000 rows; same item+batch rows are added together); nothing posts, lines just fill the form. Errors per row e.g. "'{code}' isn't in the Item Master - check the code.", "Quantity 'x' isn't a number.", "Quantity must be greater than zero.", "Item code is empty."; file errors "The file has no item rows - fill in item_code and quantity under the header row (download the template)." / "Missing column(s) ... - download the template and keep its header row." Dialog title "Excel Import".
5. Red banner when stock is short: "{n} line(s) can't be issued in full from this store - remove them, or issue only what is available." with buttons "Issue only what's available" (cuts quantities to available) and "Remove short lines".
6. Footer: "Cancel" and "Issue Material (N lines)". A draft auto-saves (Draft banner) until saved.

**Client-side validation messages (dialog "Cannot Save Material Issue")** - exact:
- "Store is required."
- "Issue Type is required."
- "{Field label} is required for this issue type."
- "Pick what this issue is against - {A} or {B}." (the types with an either/or: Maintenance, Rework, Testing)
- "Remarks are required - reason for scrapping / disposal."
- "Expected return date cannot be before today (the issue date)."
- "At least one item is required."
- "{item name}: quantity must be greater than zero."
- "{n} line(s) don't have enough stock in this store - remove them or use "Issue only what's available" (the red lines below)."

**Server-side messages (shown in the same dialog):**
- Missing type fields (422): "Issue type '{label}' needs: {field list}." For either/or: "what it is against - Work order or Machine / asset" style.
- Linked record missing: "{field label} #{id} wasn't found - pick it again from the list."
- Return date before issue date: "Expected return date (dd-mm-yyyy) is before the issue date (dd-mm-yyyy)."
- Scrap without remarks: "Issue type 'Scrap / Disposal' needs Remarks: reason for scrapping / disposal."
- Scrap by non-manager (403): "'Scrap / Disposal' writes stock off, so only a Store Manager (or {store}'s manager) or an admin can post it - ask them, or ask an admin to tick 'Store Manager' on your user."
- Challan > 50 chars: "Challan number is too long - keep it to 50 characters or fewer."
- Not enough stock (409), from the stock ledger: "Not enough stock of '{item}' in {store} - {on hand} on hand, {reserved} reserved ({available} available), {qty} requested." and, if some stock is held in Quality/Blocked, it appends "Also {x} is in Quality stock waiting for inspection and {y} is Blocked (rejected / damaged) - that can't be issued or dispatched until Quality releases it to Free stock (Quality -> Inspection Lots / NCR)."
- Frozen by a physical count: "'{item}' in {store} is being physically counted ({PC-no}) - its stock movements are on hold until that count is submitted or cancelled (Store > Physical Count)."
- Closed accounting period: "Period {Mon-YYYY} is closed in Finance > Period Close, so stock can't be moved on {date} - post with today's date, or ask Finance to reopen ..." (only matters for back-dating; the form always uses today).

**Stock effect.** Per line: Free stock (On Hand) goes down by the quantity at the store (and the bin, if a bin was picked). Transaction type "issue" (ledger row "Movements", reference type material_issue, reference = MI number). Job work posts "jobwork_out" instead (see 4.3). With valuation on, each outgoing row is priced at the item's current weighted-average cost (last unit out takes the remainder); no Finance journal is posted at issue (periodic inventory - see section 5). A batch-tracked item with no batch typed is split over batches first-in-first-out (first-expiry-first-out if expiry controlled): one issue line per batch. Serialised units change to status "issued" and record what they were issued against.

**After posting.** You land on the issue detail page (recordPath). Detail page groups: "Issued To" (Store, Department, Against, Work Order / Reference, Project chip, Purchase Requisition link), "Dispatch & Return" (Challan No., Returnable, Expected return, Purpose, Destructive test, Site, Transport, Scrap buyer) when any is filled, "Project stock used (Store Manager override)", Remarks; then the Items table (Item, Quantity, Batch, [Vehicle / lot], Remarks).

**Who approves.** Nobody. Only gates: permission, store access, and for Scrap a Store Manager. Dispatch also needs Quality and Finance clearance (3.3).

**Cancel / reverse.** Not possible on the issue itself; reverse with a Material Return (Inward > Returns) or write off with a stock adjustment.

**Notifications.** The issue itself sends none. Side effects: if available stock of the item at that store drops to/below the item's reorder level the role event "Stock fell to / below the reorder level" fires (bell); a Service issue also notifies the SR's people (see 5.4).

### 2.2 Stock Transfer (number ST-YYYY-NNNN)

**Purpose.** Move stock between two stores (also between plants). Two-step physical flow with an approval in front.

**Statuses** (list chips: All, Pending approval, To dispatch, In transit, Received, Rejected, Cancelled):
| Status | Label in screen | What moves it |
|---|---|---|
| pending_approval | Pending approval | Created by "Submit for Approval". Nothing has moved. |
| approved | Approved - to dispatch (chip: "To dispatch") | The approval engine approves (workflow "Stock transfer"). |
| in_transit | In transit | Someone with Dispatch rights clicks Dispatch. Stock LEFT the sending store (transfer_out) and sits on neither store's balance. |
| received | Received | Receiving store clicks Confirm Receipt. Stock added to receiving store (transfer_in). |
| rejected | Rejected | Approver rejects or returns it (reason shown "Rejected: ..."; "Returned for changes: ..."). Serials released. |
| cancelled | Cancelled | Raiser (or Transfers > Delete) clicks Cancel Transfer, only while pending approval or approved. |

**Step by step**
1. Create: Transfers > "+ New Transfer" (Transfers > Create). Page "New Stock Transfer", subtitle "Move stock from one store to another - approval, dispatch, then receipt."
   - **From Store** (required; only your own stores). **To Store** (required; lists stores of all plants - inter-plant allowed). Must differ: "Source and destination store must be different." (server: "Source and destination store must be different"). Inactive destination: "Store '{name}' is inactive, so it can't receive stock - reactivate it under Store -> Settings -> Stores, or pick another store."
   - **Reason** (optional text), **Remarks** (optional).
   - Items: **Item** (search), **Quantity** (>0), **Batch #** (optional text). "+ Add Item", trash button (disabled while one line). Same item+batch twice: "'{item}' is listed twice for batch X - put the total quantity on one line."
   - Footer "Cancel" / "Submit for Approval". Right panel "What Happens Next": "Nothing moves yet: the transfer goes to the sending store's manager for approval, then the sending store dispatches it with the Stock Transfer Note and the receiving store confirms receipt."
   - Client errors (dialog "Cannot Save Stock Transfer"): "Source store is required." / "Destination store is required." / "Source and destination store must be different." / "At least one item is required." / "Every item quantity must be greater than zero."
   - Availability check at creation (409): "Only {available} {uom} of '{item}' is available in {store} ({on hand} on hand, {reserved} reserved), {qty} requested. Lower the quantity, or free reserved stock in Store > Reservations first." It is re-checked at dispatch by the ledger.
   - Date: today (a future date is refused: "Transfer date ... is in the future - raise the transfer on the day it is needed (today or earlier).")
2. Approve: Central approval engine, workflow key `store.stock_transfer`, label "Stock transfer" (Organization > Approval Workflows). Default single stage "Manager of the sending store" (record field = the From store's manager, plus holders of permission Store > Transfers > Approve if the store has no manager). Self-approval is NOT allowed (the raiser cannot approve own transfer). Context available to rules: manager of sending store, manager of receiving store, "Between two plants". The Approval panel shows on the detail page while Pending (or when Rejected). Bell/Teams event "Stock transfer waiting for approval" goes to approvers; the raiser gets "Stock Transfer Approved - dispatch it from the sending store and print the Stock Transfer Note." On reject the Reason is shown in a red bar.
3. Dispatch (sending store, status "To dispatch"): button "Dispatch" (primary) opens popup "Dispatch {ST-no}" - subtitle "{from} -> {to} - stock is in transit until the receiving store confirms."; fields all optional in the UI: Vehicle Number (upper-cased on save), Transporter, Driver Name, Driver Phone, E-way Bill Number ("12 digits - required when the plants are in different states"). Popup button "Dispatch". Server checks:
   - Not approved: "Transfer {no} is {status} - only an approved transfer can be dispatched."
   - Bin recheck: "Transfer {no} can't be dispatched: Bin '...' holds only ..."
   - GST (between plants): "Plant {name} has no GST state - set its GSTIN (or state) in Organization > Plants, so the transfer can be put on a delivery challan or a tax invoice." / "Plant ... has no GSTIN. A transfer to another state is a taxable supply between distinct persons and needs both plants' GSTINs on the tax invoice - enter it in Organization > Plants." / "E-way bill number '{x}' is not valid - it is the 12-digit number from ewaybillgst.gov.in." / "This transfer goes from {plant} to {plant} - another state - so the goods need an e-way bill before they leave. Generate it on ewaybillgst.gov.in and enter the 12-digit number." / "A tax invoice needs the HSN code and GST rate of every item - fill them in the Item Master for: {codes}." / "'{item}' has no average cost to value the tax invoice at - enter its transfer price per unit."
   - Stock short at dispatch: "Transfer {no} can't be dispatched: Not enough stock of ..." 
   - GST outcome: same GSTIN or no GST data -> "Delivery challan (same GSTIN)" (no tax). Different GSTINs -> "Tax invoice" at the stock's average cost (or typed transfer rate, API only), IGST if the states differ else CGST+SGST; invoice number BT{state}/{FY}/{NNNN}. Shown in the "GST" group on the detail page.
   - Effect: transfer_out per line, Free stock of the sending store down; the line stores the dispatch value (the item's average cost). Receiving-store manager gets a notification "Stock Transfer Dispatched to Your Store"; the role event "Stock transfer dispatched to your store" goes to users with Transfers > Receive.
4. Receive (receiving store, status "In transit"): button "Confirm Receipt" -> popup "Confirm Receipt": text "All N line(s) are added to {store}'s stock at the quantities dispatched. If anything arrived short or damaged, receive it and then raise a Stock Adjustment at {store} for the difference." Field Remarks (optional). Button "Confirm Receipt". Effect: transfer_in at the receiving store, same value it left with (value-neutral, no re-costing). Raiser is notified "Stock Transfer Received". Server error if wrong status: "Transfer {no} is {status} - only a dispatched (in transit) transfer can be received."
5. Cancel: button "Cancel Transfer" -> confirm "Cancel this transfer?" / "{no} will be closed without moving any stock. This can't be undone - raise a new transfer if it is needed later." Only before dispatch. Errors: "Transfer {no} is {status} - only a transfer that hasn't been dispatched can be cancelled." / "Only the person who raised {no}, or someone with Store > Transfers > Delete, can cancel it."

**Stock Transfer Note.** A managed Word document (record `store_stock_transfer_note`), available once approved: "Save & Edit in Word" primary and "Print / Download PDF" secondary. It refreshes after dispatch (vehicle details) and after receipt (revisions 0,1,2). Before approval it says "Available once the transfer is approved."
**Shortage on receipt.** The receipt always takes the full quantity. Short/damaged material is fixed with a Stock Adjustment at the receiving store (its own approval). There is no partial receive.
**Detail page groups.** Transfer (From Store, To Store, Reason, Approved By), Dispatch (Dispatched, Vehicle / Transporter, Driver / E-way Bill), GST, Receipt (Received, Receipt Remarks), Remarks; Items table (Item, Quantity, Batch, Remarks).

### 2.3 Stock Reservation (number RES-YYYY-NNNN)

**Purpose.** Earmark Free stock for a project or production order so nobody else can issue/transfer it. It does not move stock.
**Statuses (Pills):** Active (blue) -> Fulfilled (green) or Cancelled (grey). No approval.
**Create:** Reservations > "+ New Reservation" (needs Reservations > Create). Popup "New Reservation", subtitle "Earmark on-hand stock for a project or production order - it stops being available to others."
- Section "Stock to Reserve": **Item** (required, search), **Store** (required), **Quantity** (required, > 0).
- Section "Reserved For" (all optional): **Project - Unit (vehicle / lot)** picker (hint: "Project stock can only be issued to this vehicle / lot - anyone else needs a Store Manager override with a reason."), **Project (note)** free text, **Production Order** free text, **Required Date**, **Remarks**.
- Button "Reserve Stock". Client errors: "Item is required." / "Store is required." / "Quantity must be greater than zero."
- Server errors: "Insufficient available stock to reserve - {available} available, {requested} requested" (409). Project without units is reserved as a whole project; an old sales-order project with vehicles/lots asks for the vehicle/lot.
- Effect: Reserved goes up, Available goes down, On Hand unchanged, no ledger (Movements) row.
**What it blocks.** Issue, transfer (create and dispatch), return-out and manual-out cannot use reserved quantity: "...{x} on hand, {y} reserved ({z} available)...". Adjustments/damage are allowed to go through. Production work-order material reservations and GRN-held project stock use the same mechanism (see 5.2).
**Release.** Row links (only on Active rows, need Reservations > Edit): **Cancel** (confirm "Cancel this reservation?" / "This releases the reserved quantity back to available stock.", button "Cancel Reservation") and **Fulfill** (confirm "Mark this reservation as fulfilled?" / "This releases the earmark, assuming the material has already been issued separately via a Material Issue. It does not itself reduce stock.", button "Mark Fulfilled"). Neither can be repeated ("This reservation is already '{status}'").
**List:** columns Reservation #, Item, Store, Quantity, Project / PO, Required Date, Status. Filters "All reservations" / "Project stock" (+ project picker).

### 2.4 Job Work (Material Issue of type Job Work, number MI-..., challan no. typed by the user; receipt number JWR-YYYY-NNNN)

See 4.3 for the full flow.

---------------------------------------------------------------------------------------------------

## 3. Issue types and the dynamic issue form

### 3.1 The fixed list (Store > Settings > Issue Types)
Fixed in code (2026-10-12). Labels can only be renamed (by an admin/unrestricted user). Order in the dropdown: Production, Maintenance, Project / Site, General / Office, Rework, Testing, Job Work / Subcontracting (hidden on the issue form), Scrap / Disposal, Customer Sample / Trial, Dispatch to customer, Service / Spares to site.

Rule R1: every issue names who the material is for. Rule R2: material that leaves the factory ("leaves factory") needs a Delivery challan no. (typed by the storekeeper; no number series in this form).

Required (R), optional (O), either-or (E), conditional (C):

| Type (value) | Fields asked, in order | Notes |
|---|---|---|
| Production (production) | Work order no. (O) | In-plant. Project unit picker (O) shown. Work order no. can be a Production work order or RRV build number - the project/vehicle is then filled from it. |
| Maintenance (maintenance) | Maintenance work order (E), Machine / asset (E) | At least one: "what it is against - Maintenance work order or Machine / asset". Lists only open WOs (not closed/cancelled), max 500. |
| Project / Site (project) | Project / machine (order) (R), Site address (O), Returnable? (O), Expected return date (C: required when Returnable = Yes), Delivery challan no. (R), Vehicle / courier no. (O) | Leaves factory. Project unit picker (O) shown. |
| General / Office (general) | Department (R) | Cost goes to that department. |
| Rework (rework) | NCR (E), Work order no. (E) | One of the two. Project unit picker shown. |
| Testing (testing) | Inspection lot (E), NCR (E), Destructive test? (R), Expected return date (C: required when Destructive = No) | Destructive = Yes -> material used up. |
| Job Work / Subcontracting (job_work) | Vendor (R), Process (R), Expected return date (R), Delivery challan no. (R), Vehicle / courier no. (O) | Only via Job Work > "+ New Challan". Process choices: Machining, Plating / Coating, Heat treatment, Fabrication / Welding, Testing at outside lab, Other. Extra permission Issues > Job work > Create. |
| Scrap / Disposal (scrap) | Scrap buyer (if sold) (O), Delivery challan no. (C: required if a buyer is entered), Vehicle / courier no. (O) | Remarks REQUIRED ("Reason for scrapping / disposal"). Only Store Manager / the store's manager / admin can post. Note shown: "A write-off - only a Store Manager or admin can post it." |
| Customer Sample / Trial (customer_sample) | Customer (R), Purpose (R: Sample or Trial), Returnable? (R), Expected return date (C: required when Returnable = Yes), Delivery challan no. (R), Vehicle / courier no. (O) | Leaves factory. |
| Dispatch to customer (dispatch) | Project / machine (order) (R unless a Sales Order / delivery row names it - those no longer exist in the form, so treat as required), Delivery challan no. (R), Transporter (O), Vehicle / courier no. (O), LR no. (O) | Finished goods. Quality + Finance checks (3.3). Project unit picker shown ("the vehicle / lot being dispatched"). |
| Service / Spares to site (service) | Service request (R), Site address (O), Delivery challan no. (R), Vehicle / courier no. (O) | Books the quantities on the service request (5.4). |

Field kinds on screen: dropdown "Yes/No" for Returnable/Destructive; date picker for Expected return date; searchable pick-lists (Department, Maintenance work order, Machine/asset, NCR, Inspection lot, Customer, Vendor, Service request, Project/machine); text for the rest. Label shows a red "required" marker for R and C fields and "(or the other)" for E fields. Message if a required one is empty: "{Label} is required for this issue type."
Fields a type does not list are cleared on save, so switching type never leaves old values. Department and Work order no. are common fields kept if present.

### 3.2 "Against" / charge-to
There are no GL accounts on the issue. "Charged to" is the combination of the type and its against-field: a Work order / Project / Machine / Department / Vendor / Customer / NCR / Inspection lot / Service request. The list "Issues" shows: Issue #, Purchase Requisition, Store, Issue Type, Challan No., Vendor, Department, Project / WO, Requested By, Issued By, Date, Items. The detail page shows one summary line "Against ..." built from these (e.g. "Work order WO-12 - Machine MC-01 - Project PEW-82 / 01 - Vehicle 1"). No internal-order or cost-centre field exists on this form (verified: no such field in issue_forms.py). Cost goes to Finance only through month-end closing stock valuation, not per issue. Department on General issues is the only "cost centre"-like pick.

### 3.3 Dispatch checks (type Dispatch)
Server blocks with HTTP 409: "Dispatch blocked by Quality - {reason}" (Quality rule 8: each finished-goods line needs batch/serial and an accepted final inspection, and an accepted third-party certificate when the order needs one; shown in the form note and as " - inspection required" beside the machine name) and "Dispatch blocked by Finance - {reason}" (credit limit / overdue; on hold until a Finance approver releases). After a dispatch against a project the project's lifecycle stage is refreshed.

### 3.4 Batch / bin / serial picking (column "Batch / bin / serial")
- **Batch**: for an item marked batch-controlled the picker "Auto - first in, first out" lists the store's batches as "{batch} - heat {h} - {n} free - exp {date}" (disabled with the reason if blocked/expired). With Auto it shows "Will issue {q} from {batch}, ..." or the shortfall text. For other items it is a free-text box (type the batch if known).
  Server messages: "Batch {b} of '{item}' has no Free stock in {store} - pick another batch (the list shows what is in stock)."; "Batch {b} of '{item}' can't be issued: {reason}. Pick another batch, or ask Quality / Store to release it."; "Batch {b} of '{item}' has only {x} Free in {store}, {q} requested - split the line over another batch."; "Not enough batch stock of '{item}' in {store}: {x} Free in issuable batches, {q} requested. Stock without a batch number can't be issued for a batch-tracked item."
- **Bin**: dropdown "Bin: unassigned" or "Bin {code} - {name}" (only active bins of the store; shown only if the store has bins). Server: once an item is put away into bins, you must name the bin: "'{item}' is kept in bins at this store ({bin: qty}) and only {x} is unassigned - pick the bin the {q} {uom} come from." / "Bin '{code}' holds only {x} {uom} of '{item}', {q} requested - pick another bin or split the line over bins (Store > Stock > By bin)." / "Bin '{code}' is inactive - reactivate it under Store > Inventory > Bins, or pick another bin."
- **Serial**: for serial-controlled items green/amber text "Serial no. - pick {qty} ({n} picked)" and one pill per unit In stock at that store/bin; click to select. Must pick exactly one per unit and quantity must be a whole number: "'{item}' is serial-numbered - enter the {n} serial number(s) issued, one per unit." / "'{item}': {k} serial number(s) entered for {n} unit(s) issued - enter exactly one per unit." / "'{item}' can't be issued: {serial} is {status} ... Pick serials that are in stock here (Store > Serial numbers)." / "'{item}' isn't serial-numbered (no serial profile in the Item Master), so don't enter serial numbers for it ..."

### 3.5 Project stock rules on an issue (types Production, Rework, Project / Site, Dispatch only)
- The picker "Project unit" appears for those four types ("(required for an RRV order)" / for Dispatch "(the vehicle / lot being dispatched)"; hint: "Filled from the RRV build / work order no. when it has one. The vehicle's project stock is issued first."). A project made in Project Management has no units - picking the project links the issue to the project itself.
- The issue first consumes stock reserved for that same project/unit.
- If free stock is short and the rest is held for ANOTHER project/vehicle, a normal user gets (409): "{short} of the {qty} {code} - {name} needed is project stock held for another project / vehicle: {list of holds with RES no.}. It can't be issued to {target}. Issue it against the project that holds it, reserve / buy stock for this one, or ask a Store Manager to release it (they must give a reason)."
- A Store Manager (user flag "Store Manager", the store's manager, or admin) can override by filling "Reason for using project stock"; without it (422): "... As a Store Manager you may still issue it ..., but say why in 'Reason for using project stock' - it is recorded on the issue and on the reservation." The reason is stored on the issue and appended to remarks; the hold is released and shown in the detail row "Project stock used (Store Manager override)".
- Errors about the project link (422): "{Source} builds {element}, but the issue names {element} - pick the element of that ... (or correct the work order no.)"; "{project} isn't the project of {source} ... pick ..."; "... is for {project}, a project created from a sales order that has units - pick the vehicle / lot this material goes to in 'Project unit', so the material is booked to that vehicle."
- One issue goes to one vehicle/lot ("A line names ... but the issue is for ... - one issue goes to one vehicle / lot"), except a Dispatch which may ship several.
- Other types (Maintenance, General, Job work, Scrap, Sample, Testing, Service) never link to a project and cannot draw project-held stock.

---------------------------------------------------------------------------------------------------

## 4. Transfers, Reservations, Job Work in short

### 4.1 Transfers
Two steps after approval: Dispatch (stock out of sending store -> in transit, on neither balance) and Confirm Receipt (stock into receiving store). Full lifecycle in 2.2. Quick view for the keeper: raise -> sending store manager approves -> sending store Dispatch (vehicle, e-way bill) -> print Stock Transfer Note -> truck -> receiving store Confirm Receipt.
Where to see goods in transit: Transfers list chip "In transit"; the quantity is not in Stock page columns for either store. (A route /store/in-transit exists in the backend but no Store page uses it - not documented.)

### 4.2 Reservations - see 2.3. Use before a big project build; check the Available column on Stock.

### 4.3 Job Work (subcontracting) - page /dashboard/store/job-work
Header: "Job Work". Text: "Material sent to job workers on a challan stays ours and valued (stock with vendor) until it comes back or is used in the processed item. GST Rule 45: it must be back within 1 year (inputs) / 3 years (capital goods)." Cards: "Open challans", "Value at vendors" (only with Items > Stock value & rates), "Past Rule 45 limit". Tabs: Challans, Stock with Vendors, Job Work Receipts (only with receipts view), ITC-04. Checkbox "Show closed challans too".

**Step 1 - send (New Challan).** "+ New Challan" opens "New Job Work Challan" (subtitle "Material sent to a job-work vendor - it stays ours, in With-vendor stock, until it comes back."). Issue Type is fixed. Fields: Store, Vendor (R, from Vendor master, active vendors), Process (R), Expected return date (R), Delivery challan no. (R, max 50), Vehicle / courier no. (O), Remarks, Items to send (same item table incl. batch/bin/serial), and a second table **Items to receive back** (optional): what the vendor returns (can differ, e.g. plate sent, flange + ring back). Empty = the same items come back (plating, heat treatment). A quantity left blank is "not known yet". Errors: "Items to receive back - {item}: quantity must be greater than zero, or leave it blank." Button "Create Challan (N lines)".
- Stock effect: Free -> **With Vendor** bucket (ledger type jobwork_out, reference the MI number). Still our stock and still valued; never issuable.
- The issue detail page shows "Job Work Challan" with the managed Word challan (record store_job_work_challan, "Save & Edit in Word", company letterhead, GSTIN/HSN/value) and a button "Open in Job Work (stock at vendor, receive back) ->".
**Challan status** (pill): "At vendor" (open), "Past expected return" (today after expected return date), "Rule 45 limit passed" (overdue: > 365 days inputs, > 3x365 days for item types asset / tool & equipment), "Closed" (nothing outstanding). Columns: Challan, Date, Vendor, "Material (sent / back / used / at vendor)", Value at vendor, Days out, Return by (Rule 45), Status. Daily reminders (bell/Teams, event "Job-work material due back") at 300/330/360 days (inputs) and 1000/1080 days (capital goods).

**Step 2a - vendor returns processed goods: "Receive processed items"** (row link, needs job_work_receipts create). Popup "Receive processed items". Sections "Processed Items" (Processed item (R, Item Master), Qty received (R), Job charge from PO line (O, only issued POs of that vendor), Job charge / unit, Cost share % (only when several items; all or none, must total 100); Import from Excel), "Challan Material Used" (per challan line: At vendor, Used in items, Process scrap - at least one > 0), "Receipt Details" (Receipt date - default today, Vendor's DC / invoice O), Remarks. Button "Post receipt". On success dialog "Job Work Receipt Posted".
 - Posting: challan material leaves With-vendor stock (jobwork_consume at average cost); each processed item enters Free stock at (its share of the used material value + its job charge) / qty, cost source job_work; if the item needs a job-work inspection it goes to Quality stock with an inspection lot instead; a batch-tracked item gets a new batch carrying the heat numbers. Receipt number JWR-YYYY-NNNN.
 - Key errors: "Add the processed item(s) that came back (Item Master)." / "{item}: enter how many came back." / "Cost share % is filled on some items and blank on others - fill every line (total 100) or leave all blank." / "Cost shares add up to {x}% - they must total 100%." / "Only {x} of '{item}' is still with {vendor} on challan {no}; {y} entered as consumed + scrap." / "Enter the quantity of challan material used (consumed and/or process scrap)." / "Receipt date ... is in the future - record it on the day the goods arrive." / "Receipt date ... is before the challan date ..." / "PO {no} is with {vendor}, but the challan went to {vendor} - pick that vendor's job-work PO." / "PO {no} is draft - the job charge must come from an issued PO." / "Challan {no} was posted before job-work stock tracking started, so its material isn't in With-vendor stock - receive the processed item through a GRN / Return instead." (old challans only)
**Step 2b - vendor returns the same material unprocessed: "Return as-is"** (needs Returns > Create). Popup "Return as-is": per line Qty back and Condition (Good/Damaged/Rejected (quality)), Reason (R: "Say why it came back unprocessed (e.g. vendor could not do it, extra sent, order changed)."), Remarks. Button "Record return". It creates a Material Return "Against a Material Issue" (MR-YYYY-NNNN). Message after: "... Stock with the vendor is reduced." or "... waiting for approval; stock with the vendor goes down once it is approved." Line shows "(n return awaiting approval)". Error "{item}: only {n} {uom} is still with the vendor."
**Stock with Vendors tab:** Vendor, Item, Quantity at vendor, Value, Challans, Oldest challan. **ITC-04 tab:** From/To dates -> "Show report" (Table 4 sent, Table 5A received back, outstanding, overdue) + Excel download (export permission). "'To' (...) is before 'From' (...) - pick the quarter / half-year again."

---------------------------------------------------------------------------------------------------

## 5. How Store connects to other modules

### 5.1 Procurement (PR -> RFQ -> PO -> GRN)
- **PR approved -> automatic store check.** When a Purchase Requisition becomes approved the server re-checks Available stock (all stores, on hand minus reserved) for each line that carries a Store item (every PR line does: lines are matched by `store_item_id`, never by name). Not in store (or not linked) -> line goes straight to procurement (RFQ). Fully in store -> waits for the Store Manager picked on the PR to issue it. Partly in store -> buyer/Store split. Audit entry "Automatic store-stock check on approval of {PR}: ..." and bell to the buyer "PR Approved - Stock Check Result".
- **Where the user sees it:** Procurement > Purchase Requisition detail (/dashboard/p2p/{ref}): per line stock status and, for the Store Manager named on the PR, button **"Issue from Stock"** (or **"Issue {x} & Buy {y}"** for a partial) with a mandatory comment ("Add a comment before issuing - e.g. who received it or where it was handed over..."); the buyer has **"Send to Procurement"**. Non-managers see "Waiting for the Store Manager to issue from stock". Only the Store Manager picked on the PR (or admin) may issue: "Only the Store Manager picked on this requisition can issue its items from store stock."
- **What it posts:** a Material Issue (MI-...) with no issue type and the PR linked (list shows the PR number in column "Purchase Requisition" and in "Against"; type column "-"), transaction type issue, reference type p2p_request. A partial issue splits the line: issued part is fulfilled, the remaining quantity goes to procurement; a PR whose every line is issued or short-closed is auto-closed. Requester gets "Item Issued from Stock". After this the PR can no longer be edited.
- **PO and GRN:** buying is in Procurement. Goods arrive in Store > Inward > GRN & Inspection (other notes): accepted -> Free stock, rejected -> Blocked, waiting -> Quality. Stock is valued at the PO rate. If a GRN line is for a project, the received stock is automatically **held (reserved) for that project/vehicle** when it reaches Free stock (reservation "Held from {GRN no}", visible in Reservations > "Project stock"); reversing the GRN releases that hold.
- RFQ per buyer / PO per vendor splits are Procurement matters; Store sees only the resulting GRNs.

### 5.2 Projects
- Issue material to a project: type Production / Rework / Project/Site / Dispatch + "Project unit" picker (3.5), or reserve it first (2.3).
- Where the project side shows it: Project Management > project > tab **Store Issues** (columns Issue No., Date, Type, Issued to, Lines, Status), and the project's Units/360 view shows a "Store" cell per unit: "{n} item(s) held", "{n} item(s) issued" or "Short: {n} item(s)" (build outstanding material not covered by holds). Click chips open the project (needs Projects > All Projects view).
- On the Store side Issues list column "Project / WO" shows the work order reference; the project chip shows on the issue detail "Issued To > Project".
- The old per-module "Ongoing Projects" link in Store goes to Project Management > My Tasks.

### 5.3 Finance
- **Valuation:** when the Store setting "Weighted-average valuation on" is on (turned on by a cut-over, no UI toggle), every movement carries a rate/value: issues and dispatches go out at the current company-wide weighted-average cost; transfers are value-neutral (receiving store gets the value it left with); job work out/in is value-neutral. Money columns are hidden without Items > "Stock value & rates".
- **GL postings:** Finance uses the *periodic* method: nothing posts to the ledger on a store issue/receipt. At month end Finance (Finance > Inventory Accounting, page title "Inventory Accounting"; button "New closing-stock valuation") snapshots Store on-hand + Quality + Blocked + With vendor at weighted-average cost and posts Dr Stock-in-Hand / Cr Changes in Inventories, auto-reversed next day. So issued material reduces closing stock and shows up as cost of materials consumed automatically.
- **Posting lock:** stock cannot be moved in a closed period (message in 2.1); stock moves also stop while a physical count is open.
- **Transfers between plants** create GST documents (delivery challan or tax invoice) - see 2.2. Dispatch to customer is gated by Finance credit control (3.3).
- A scrap issue has no automatic write-off voucher; Finance sees the effect through closing stock.

### 5.4 Service (Service Requests, ERP)
- Service > Service Request detail > **Material Request** (popup "Material Request"): engineer picks Item Master items + qty. The server checks free store stock (all stores, on hand minus reserved): the part available becomes a material line "from store" (status pending) and the shortfall automatically raises a Purchase Requisition (type Service, created already approved, no PR approval) - one request, server auto-splits; no PR fields on the form. Result lists "from_store" and "to_buy"; message if user lacks PR permission: "Not enough in store (...). Buying the shortfall needs the Service Requests > Purchase Requisition permission - ask your admin to grant it, or reduce the quantity to what is in store."
- **Store issues the spare:** either from the SR Materials tab (Issue from Store, endpoint `/erp/service-requests/{sr}/materials/{mat}/issue`, needs Service Requests > Spare issue > Create AND Store > Issues > Create) or in Store with type **Service / Spares to site** (Service request + Delivery challan no. required). Both post one Material Issue (MI-...) of type Service; the issued quantity and weighted cost are booked on the SR material line ("Issued {n}"), and unused spares come back by a return posting. Errors: "Issuing spares from Store needs Store > Material Issues > Create in the Permission Matrix. Ask the Store team to issue it from this SR (or from Store > Material Issue, type Service)...", "{SR} is closed, so spares can't be issued against it - reopen it ...". The engineer "asks, Store issues": the engineer cannot take stock without a Store user.
- A closed/cancelled SR is not offered in the Service request pick-list.

### 5.5 Other links seen in outward screens
Maintenance (work orders/assets for Maintenance issues), Quality (NCR, inspection lots, dispatch release, job-work inspection, Blocked/Quality stock), Sales/CRM (Customer for samples), Production (work order no., RRV build, work-order material reservations), Organization (departments, plants/GSTIN, approval workflows).

---------------------------------------------------------------------------------------------------

## 6. Demo script - issue demo items to a project (10 steps)

Suggested sample data (create/confirm first as admin): Store "Main Store"; items "Hex bolt M12x50" (item code e.g. 21, UOM Nos) and "Flat washer M12" (code 22, Nos) with stock 200 and 500 (from a GRN, so it is realistic); project "PEW-82" (Central Railway) created in Project Management; a user with Store Issues create + Reservations create; a Store Manager user.

1. Open Store > Inventory > Stock. Find the two items in Main Store and note On Hand (Free) 200 / 500, Reserved 0, Available 200 / 500.
2. Outward > Reservations > "+ New Reservation". Item "21 - Hex bolt M12x50", Store "Main Store", Quantity 40, Project - Unit: pick "PEW-82", Required Date: next week, Remarks "Frame assembly". Click "Reserve Stock". Row shows RES-2026-NNNN, Active, project chip PEW-82.
3. Back on Stock: Reserved 40, Available 160 (On Hand still 200). Explain: reserved stock blocks every other issue/transfer.
4. Outward > Issues > "+ New Issue". Store "Main Store". Issue Type "Production". Work order no.: leave blank (or type WO number if one exists). Project unit: pick "PEW-82". Remarks "Frame assembly - 1st lot".
5. Items: Line 1 item 21, Quantity 30 (watch "Available in store: 200 ... 200 on hand, 40 reserved" - the project's own hold is used first). Click "Add Item", Line 2 item 22, Quantity 60. Leave Batch on "Auto - first in, first out" if the items are batch-tracked; pick a bin if the store uses bins.
6. Show the shortage guard: set Line 1 quantity to 500 -> red row "Short by 300", red banner, the buttons "Issue only what's available" / "Remove short lines". Set it back to 30.
7. Click "Issue Material (2 lines)". You land on the new issue MI-2026-NNNN: Issued To shows "Production issue from Main Store ... against PEW-82". Items table shows quantities and batch.
8. Back to Stock: item 21 On Hand 170, Reserved 10 (reservation reduced from 40 to 10), item 22 On Hand 440. Inventory > Movements shows two "issue" rows with reference MI-2026-NNNN.
9. Open Project Management > PEW-82 > tab "Store Issues": the issue appears (Issue No., Date, Type, Issued to, Lines). Optional: in Reservations click "Fulfill" on the remaining 10 -> confirm "Mark Fulfilled" (does not change stock, just frees the hold).
10. Try the guard rails: as a non-manager issue 200 of item 21 to another project/General type -> blocked with "...project stock held for another project / vehicle..."; then as Store Manager fill "Reason for using project stock" to override. Finally show reversal: Inward > Returns > New Return "Against a Material Issue" picks MI-2026-NNNN (an issue itself cannot be edited or cancelled).
Optional extra for transfers: Transfers > "+ New Transfer" Main Store -> Plant 2 Store, item 22 qty 100, Submit for Approval; approver approves; Dispatch with vehicle HR55 AB 1234; Confirm Receipt at the other store; open the Stock Transfer Note.

---------------------------------------------------------------------------------------------------

## 7. Open questions and screen-vs-tour / screen-vs-backend disagreements

1. **Transfer tours are stale.** `storeTransferForm.ts` (button "Transfer Stock") and `storeTransferDetail.ts` say the transfer posts a paired out/in movement immediately. Real flow: "Submit for Approval" -> approval -> Dispatch -> In transit -> Confirm Receipt. Manual should follow the screen. Also the tour has no steps for Dispatch / Confirm Receipt / Stock Transfer Note.
2. **Issue Types tour is stale.** `storeIssueTypes.ts` still describes "+ Add Issue Type", Delete, and "Issue Rules decide Challan No., Vendor or return Date". Backend: issue types are fixed in code - POST and DELETE answer 409 "Issue types are fixed in code and can't be added, switched off or changed here - only renamed. Extra mandatory fields per type (vendor, return date, challan) are set in Store > Settings > Issue Rules." But Issue Rules is retired (page redirects) - so that error text points to a page that no longer exists; and the Issue Types page (`DocTypeSettings`) still renders a "+ Add Issue type" button for users with issue_types create and an Edit/Delete column, which will end in that 409. Need a product decision: hide Add/Delete for issue kind (and fix the message).
3. **Issue form tour** (`storeIssueForm.ts`) has no steps for the dynamic per-type fields, project unit, batch/bin/serial, short-stock banner; its "Project / Work Order" free-text field no longer exists as a general field (only Production/Rework "Work order no.").
4. **Transfer form has no bin or serial pickers** although the backend supports `from_bin_id`, `serials` per line and `to_bin` per line on receipt, and the BinSerialPicker comment says it is used for "issue, transfer". Consequences: transferring a serial-numbered item from the UI is refused ("'{item}' is serial-numbered - enter the N serial number(s) transferred, one per unit."); an item already put away in bins fails with "kept in bins ... pick the bin"; the dispatch notification text says "Confirm receipt ... (pick the bins there)" but the Confirm Receipt popup has no bin picker, and the Dispatch popup has no per-line transfer rate (needed for GST tax invoice when the item has no average cost). Confirm with owner whether these are gaps to fix; the manual should warn storekeepers meanwhile.
5. **Permission matrix shows Issues edit/delete**, but there is no edit or delete on an issue anywhere. Manual should say issues are final.
6. **Dispatch type "unless sales_order" rule** in `issue_forms.py` mentions Sales Order / delivery rows that were retired (2026-10-30); the form always asks for "Project / machine (order)" for dispatch, with the client treating it as required. Spares-only dispatches without a machine therefore cannot be created. Open question whether spares dispatch needs another way.
7. **No cost-centre / internal-order / GL "charge to"** exists on the issue form. If the manual promises it (task brief mentions "internal order / cost centre") it must be written as: charge-to = the type's "against" field; Finance recognises cost only at month-end closing stock. Confirm with owner.
8. **Issue lists have no status, filters, search or export** (page only has the table; list not sorted by Issue # explicitly - backend returns newest first by created_at, which conflicts with the app rule "tables with a code/id load ascending"; transfers and reservations also newest first). Worth confirming.
9. **Job Work ITC-04 and Rule 45** wording is on screen as "GST Rule 45 / ITC-04"; fine for the manual but the Issue Types "no SAP words" rule: the code comments use SAP terms, the screens do not (checked visible strings - none seen).
10. **Reservation "Fulfill"** does not issue anything; users may expect it to. Wording on the confirm dialog says so. Also manual reservations never expire automatically.
11. **In-transit visibility:** transferred stock in transit is on no store's Stock page; the only place is Transfers > "In transit" chip. (A backend route `/store/in-transit` exists, no page found.)
12. **Receiving a transfer is all-or-nothing** (no short receipt); shortages go through a Stock Adjustment at the receiving store.
13. Approval of transfers uses the sending store's manager; if the raiser IS that manager, self-approval is blocked (allow_self_approval False) and the engine's fallback applies - not verified in the engine code (outside my area); ask the approvals researcher.
14. Not verified: exact Hindi/English UI string for the Teams message layout, and what the Item Master flag names read on screen ("Batch tracked", "Serial numbers") - covered by the Item Master notes.
