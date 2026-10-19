# Store Module

The Store module (shown in the app as "Store & Inventory") is where the company keeps its Item Master and every physical stock movement. It holds the list of every item the company buys, stores, uses or sells (materials, services, assets, consumables, tools), the stock of each item in each store (warehouse), and the documents that move that stock: goods receipts (GRN) from vendors, material issues to jobs, material returns, store-to-store transfers, stock adjustments, physical counts and reservations. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) it sits at the Store/Purchase step: BOMs and purchase requisitions pick items from the Item Master, purchased goods land here through the GRN, Production and Maintenance draw material through Issues, Quality decides incoming lots and blocked stock, finished goods leave through a "Dispatch to customer" issue, and Finance reads the item ledgers and the weighted-average stock value. Since 2026-10-12 there is no free-hand "add / remove stock" screen: every movement must have its own document (GRN, Issue, Return, Transfer, Adjustment, Physical Count), and opening stock at go-live is loaded only by an admin through Opening Stock Import.

## 1. Navigation Tabs

The Store sub-nav (StoreNav) sits above every Store page header. It has four top-level groups (shown in capitals with an icon). When a group with more than one document is open, a second row of pill tabs shows that group's documents. A group or pill is shown only if the user has View access to that Store tab (role permissions). On the right of the top row are the guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Inventory (group) | /dashboard/store | Opens the first visible pill of the group (normally Item Master). |
| Inventory › Item Master | /dashboard/store | The list of all items (also owns /dashboard/store/new and the item pages). |
| Inventory › Stock | /dashboard/store/stock | Current stock per item per store, with Store Overview, Item × Store and All Balances views. |
| Inventory › Movements | /dashboard/store/movements | Read-only stock ledger (every posting). |
| Inventory › Adjustments | /dashboard/store/adjustments | Stock adjustment documents that need Store Manager approval. |
| Inventory › Reorder | /dashboard/store/reorder | Items at or below their reorder level, with one-click Purchase Requisition. Shown to users with Stock access. |
| Inventory › Physical Count | /dashboard/store/cycle-count | Physical stock counts (shown to users with Adjustments access). |
| Inward (group) | /dashboard/store/grn | Material coming into a store. |
| Inward › GRN & Inspection | /dashboard/store/grn | Goods receipts against purchase orders and their quality inspection. |
| Inward › Returns | /dashboard/store/returns | Material returned to a store (unused, damaged or rejected). |
| Outward (group) | /dashboard/store/issues | Material leaving a store. |
| Outward › Issues | /dashboard/store/issues | Material issues (stock out to a job, department, vendor, customer, scrap…). |
| Outward › Transfers | /dashboard/store/transfers | Store-to-store stock transfers. |
| Outward › Reservations | /dashboard/store/reservations | Stock earmarked for a project / production order. |
| Settings (group) | /dashboard/store/settings | Master data. Has its own pill row (Item Types, Units of Measure, Categories, Stores, Issue Types). See section 4. |

Notes:
- /dashboard/store/project-work is an old link. It now redirects to the company-wide Ongoing Projects page (/dashboard/ongoing-projects), keeping an opened project (?id=).
- /dashboard/store/settings/entry-types and /dashboard/store/settings/issue-rules are old links that redirect to Store Settings (Stock Entry Types and Issue Rules were retired on 2026-10-12).

## 2. Dashboard

The Store module has no separate dashboard page. The module landing page (/dashboard/store) is the Item Master list (see 3.1). The closest thing to a dashboard is the **Store Overview** view on the Stock page (/dashboard/store/stock), described here. All its numbers are worked out in the browser from the stock balances the user is allowed to see (their plant's stores unless their Store data access is organisation-wide), after the page filters (search, store, category, subcategory) are applied. Only balance rows with a total quantity above zero are counted.

The "rate" used for values = the item's system weighted average (moving average cost), else its standard cost, else its last receipt rate, else 0. Total quantity of a balance = On Hand (Free) + Reserved + Quality + Blocked.

### Stock Value card
- Shows the sum of total quantity × rate across all counted balances, in rupees (no decimals).
- Hint text: "At moving average / standard cost", or, if some lines have no rate, "N line(s) have no rate — set standard cost on the item".
- **Actions:** none (display only).

### Stores Holding Stock card
- Number of stores that have at least one balance with stock; hint shows the number of distinct items in stock.
- **Actions:** none.

### At / Below Reorder card
- Number of store balances where the item has a reorder level above 0 and the balance's Available quantity is at or below that reorder level. Shown in red when above zero.
- **Actions:** none (use the Reorder tab to act).

### In Quality card
- Number of store balances with quantity in Quality stock (received, waiting for an inspection decision). Blue when above zero.
- **Actions:** none.

### Blocked card
- Number of store balances with quantity in quarantine (Blocked stock — cannot be issued). Amber when above zero.
- **Actions:** none.

### Transfers In Transit card
- Shown only when the transfer list loads. Number of stock transfers in status "In transit" (dispatched, not yet received — on neither store's balance). Purple when above zero.
- **Actions:** none.

### Stock by Store table
- One row per store, sorted by stock value (highest first). Columns: Store, Items (number of items in stock), Stock Value, Available Value (Available qty × rate), At / Below Reorder, In Quality, Blocked (counts; "—" when zero).
- **Actions:** clicking a row sets the Store filter to that store and switches to the All Balances view.

## 3. Screens

### 3.1 Item Master — /dashboard/store

#### List view
Header: "Store & Inventory" / "Item Master". The table fills the page height and scrolls on its own.

| Column | What it shows |
|---|---|
| Code | Item code (auto-generated, e.g. MT-HYD-0001). |
| Type | Item type label (Material, Service, Asset, Consumable, Tool & Equipment, or any type added in Settings). |
| Category | Item category name, or "—". |
| Subcategory | Subcategory name, or "—". |
| Name | Item name. |
| UOM | Unit of measure code, or "—". |
| Technical Specification | Item description (technical specification), cut to one line; full text on hover. |
| Status | Active / Inactive / Discontinued pill. |

Filters and search:
- Search box "Search by name, code or technical specification…". Server-side word-by-word search: every word must appear in the item name, code, legacy (v3 / Tally) code, part code, technical specification or category. Results are ranked: exact name match first, then name starts with, name contains, all words in name, code match, then the rest; A–Z within each group. With no search, items are sorted A–Z by name.
- Type dropdown (All Types + every item type). Changing it clears Category and Subcategory.
- Category dropdown (All Categories + top-level categories of the picked type, or of all types).
- Subcategory dropdown (disabled until a category is picked; lists that category's subcategories).
- "Clear filters" link appears when any filter is set.
- Empty messages: "No items match these filters." or "No items yet — add the first item to the master."

Row actions: click a row to open the item page (signed link).

Top buttons:
- **Export** (needs Items › Export): downloads an Excel file of exactly what the list shows (same search and filters), named item_master_[type]_[date].xlsx. Columns: Item Code, Item Type, Category, Subcategory, Item Name, UOM, Technical Specification, Status, Lead Time (days), Legacy Code, Part Code, HSN / SAC, GST %, Preferred Vendor (vendor code), Standard Cost, Min Order Qty, Reorder Level.
- **Import** (needs Items › Import): opens the Import Items dialog (see below).
- **+ Add Item** (needs Items › Create): opens Add Item.

Import Items dialog:
- Explains the file: CSV or Excel with columns item_type, category, subcategory, item_name (required), uom (required), technical_specification. Optional extra columns accepted by the server: lead_time_days, legacy_code, part_code, hsn_sac_code, gst_rate, preferred_vendor (vendor code or exact name), standard_cost, min_order_qty, reorder_level.
- **Download template** gives item_master_import_template.csv. Click the dashed box to pick a .csv or .xlsx file; **Import** uploads it; **Cancel** closes.
- Item codes are always generated by the app (an item_code column is ignored). Maximum 5,000 rows per file.
- A row whose item name AND technical specification both match an existing item (or an earlier row in the same file) is not saved.
- Result screen shows three blocks: "New items saved" (Row, Item Code, Name, Type, Category), "Already exist — not saved" (Row, Name in file, Existing Item, Why) and "Problems — not saved" (Row, Name, Fix — e.g. empty name, UOM not in the unit list, invalid item type, category not of that type, subcategory without category, bad lead time, duplicate legacy code). Buttons: **Import another file**, **Done**.

#### Create form — Add Item (/dashboard/store/new)
Header "Add Item" with **← Back** (top right). Sections in order: Item Details, Planning, Purchasing, Tax & Accounts, Stock Levels & Cost, Quality & Tracking, Photo.

Item Details:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item Code (auto) | text (read-only) | — | Preview from the server for the current type + category | Format TYPE PREFIX-CATEGORY CODE-NNNN (e.g. MT-HYD-0001), numbered per type + category pair; "GEN" when no category. The preview is not reserved; the real code is assigned on save. |
| Item Type | dropdown | Yes (defaults to Material) | Item Types master | Changing the type clears Category and Subcategory. Must be a valid type. |
| Category | dropdown | No | Top-level categories whose item type matches | Changing it clears Subcategory. |
| Subcategory | dropdown | No | Subcategories of the picked category | — |
| Item Name * | text | Yes | — | "Item Name is required." |
| UOM * | dropdown | Yes | Units of Measure master | Must be a unit in the list (stored uppercase). |
| Part Code (optional) | text | No | — | Trimmed. |
| Technical Specification | multi-line text | No | — | Stored as the item description; used in search and duplicate checks on import. |

Planning:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Purchase lead time (days) | number | No | — | Whole calendar days from PO to goods in store, 0 to 730. Used by MRP and the Engineering long-lead list. |
| Legacy code (optional) | text | No | v3 / Tally code | Max 50 characters; must be unique (case-insensitive) across items. |

Purchasing:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Preferred vendor | searchable dropdown | No | Active vendors from the shared vendor master ("Name (Code)") | Must exist and be active. Suggested first on purchase requisitions and RFQs. |
| Minimum order qty (unit) | number | No | — | 0 or more. Planning rounds orders up to it. |
| Make / Brand | text | No | — | Hidden for Service items. |
| Manufacturer | text | No | — | Hidden for Service items. |
| Manufacturer part no. | text | No | — | Hidden for Service items. |

Tax & Accounts:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| HSN code (SAC code for services) | text (max 12) | No | From the vendor's tax invoice | Digits only. Goods: 4, 6 or 8 digits. Services: 6 digits starting with 99. |
| GST rate | dropdown | No | Active rates from Finance's GST rate master | Must be an active rate. |
| Purchase ledger | searchable dropdown | No | Active posting GL accounts of purchase types | Blank = use the category's ledger, then Finance's default. |
| Sales ledger | searchable dropdown | No | Active posting GL accounts of sales types | Blank = category / Finance default. Only for items also sold. |

Stock Levels & Cost (hidden for Service items):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Standard cost (₹ per unit) | number | No | — | 0 or more. Planning rate for BOM estimates; stock is valued at weighted average, not this. |
| Reorder level (unit) | number | No | — | 0 or more; cannot be above maximum stock. |
| Reorder qty (unit) | number | No | — | 0 or more. |
| Safety stock (unit) | number | No | — | 0 or more; cannot be above reorder level. |
| Minimum stock (unit) | number | No | — | 0 or more; cannot be more than maximum stock. |
| Maximum stock (unit) | number | No | — | 0 or more. |

Quality & Tracking (hidden for Service items):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Inspection on receipt | checkbox | No | — | When ticked, GRN and production receipts go to Quality stock with an inspection lot instead of straight to Free stock. Unticking also unticks the test certificate box. |
| Test certificate (MTC) required | checkbox | No | — | Enabled only when Inspection on receipt is ticked (server refuses it otherwise). An incoming lot can't be accepted until the certificate is marked received. |
| Batch / heat number tracked | checkbox | No | — | — |
| Serial number tracked | checkbox | No | — | One serial per unit. |
| Has expiry | checkbox | No | — | When ticked, a "Shelf life (days)" number box appears and becomes required. |

Photo:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Photo | image file | No | Click the box to pick | Must be an image (JPG / PNG / WEBP), under 5 MB. Uploaded to SharePoint after the item is saved. |

Buttons: **Save Item** (creates the item, uploads the photo, then opens the item page) and **Cancel**. If the photo upload fails, the item is still saved and a "Photo Not Uploaded" message explains why; closing it opens the item page. Errors show in a "Cannot Save Item" dialog with the server's reason.

#### View page — /dashboard/store/[item]
Header: "Store & Inventory · [item code]" and the item name. Buttons (top right): **← Back**, **Edit** (needs Items › Edit), **Delete** (needs Items › Delete; items have no creator, so anyone holding the permission may delete).

Sections:

Photo — shows the saved photo or "No photo". With Items › Edit, clicking the box adds or changes the photo immediately; **Change** and **Remove** links appear (Remove asks for confirmation).

Item Details:

| Field | Meaning |
|---|---|
| Item Code | Auto-generated code. |
| Item Type | Type label. |
| Category / Subcategory | Classification. |
| Item Name | Name. |
| UOM | Unit of measure. |
| Part Code | Part code or "—". |
| Status | Active, Inactive or Discontinued. |
| Technical Specification | Description. |

Planning & Cost:

| Field | Meaning |
|---|---|
| Purchase lead time | "N calendar day(s)" or "Not set — MRP will assume one". |
| Legacy code (v3 / Tally) | Old system code. |
| Standard cost | Planning rate in rupees. |
| Weighted average | System weighted average cost (read-only, kept by priced receipts), with the last receipt rate and date; "Not valued yet" if none. |

Purchasing: Preferred vendor (or the old free-text supplier marked "not linked to the vendor master — pick it again"), Minimum order qty, Make / Manufacturer and Manufacturer part no. (not for services).

Tax & Accounts: HSN / SAC code ("Not set — needed on GST invoices"), GST rate, Purchase ledger and Sales ledger — the ledger that will actually be used and where it comes from (set on this item; from the item's category; Finance's default ledger; or "no ledger — Finance must set the default under Finance → Masters → Ledger Settings").

Stock Levels (not for services): Reorder level / qty, Safety stock, Min / Max stock.

Quality & Tracking (not for services): Inspection on receipt (Yes/No with explanation), Test certificate required, Batch / Serial tracked, Expiry (with shelf life).

Vendors for this item — table: Vendor (with a green "Preferred" pill), Last PO rate, Last PO (number and date), POs / Qty bought, Catalog price, Catalog lead time. Order: preferred vendor first, then vendors bought from (latest first), then vendors whose catalog lists the item. Matching uses the item id on PO lines; older unlinked lines and catalog entries match by item / legacy / part / manufacturer part code or the exact item name. Draft and cancelled POs are ignored.

#### Edit
Clicking **Edit** replaces the read-only sections with the same form as Add Item (Item Details, Planning & Cost, Purchasing, Tax & Accounts, Stock Levels & Cost, Quality & Tracking).
- Item Code is read-only and never changes.
- Status dropdown is added (Active, Inactive, Discontinued).
- Weighted average is shown read-only.
- UOM cannot be changed once the item has any stock movement ("create a new item for the new unit"), and cannot be blanked.
- Changing Item Type clears Category and Subcategory.
- The ledger pickers show "Now: [ledger] ([source])" under them when left blank.
- All validation rules from Add Item apply (merged with the saved values).
- Buttons: **Save Changes** and **Cancel** (the header shows Cancel instead of Back/Edit/Delete while editing).

Delete: confirmation "Delete this item?". The server refuses if the item has any stock movements, issue lines, return lines, transfer lines, adjustment lines or reservations ("Set its status to Inactive instead"), or if another module (BOM, work order, design document, spare-part list) still links to it.

#### Statuses & workflow
Item status: Active (offered everywhere), Inactive, Discontinued. Changed only by editing the item. No approval.

### 3.2 Stock — /dashboard/store/stock

#### List view
Header: "Store & Inventory" / "Stock". If the user's Store data access is limited to their plant, a line says "Showing stock of your plant: [plant]" or, if no plant is set, explains that no stock is shown and how to fix it.

Top buttons:
- **Export** (needs Stock › Export): Excel of the stock with the same search, store, category and subcategory filters (stock_[date].xlsx).
- **Opening Stock Import** (admin only): opens the Opening Stock Import dialog.

Filters: search box ("Search item code, name, store…" — matches item code, name, store, vendor, category, subcategory), All stores, All categories, All subcategories (subcategory list follows the category). **Clear** appears when a filter is set. Filters apply to all three views.

View pills: **Store Overview** (default — see section 2), **Item × Store**, **All Balances**.

Item × Store view:

| Column | What it shows |
|---|---|
| Item (available qty) | "Code — Name". |
| One column per store | Available quantity of the item in that store with its unit, or "—". |
| Total | Sum of available quantity across the shown stores. |

All Balances view ("Current Balances"):

| Column | What it shows |
|---|---|
| Item | "Code — Name". |
| Store | Store name. |
| On Hand (Free) | Usable stock. |
| Reserved | Quantity earmarked by reservations. |
| Available | On Hand minus Reserved (the quantity that can be issued). |
| Quality | Received stock waiting for a Quality inspection lot decision (cannot be issued). |
| Blocked | Quarantined stock (cannot be issued). With Adjustments › Create, a **Clear** link appears. |

Clear Quarantine dialog (from the Blocked column):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| What happened to it? | dropdown | Yes | Scrap — write it off; Returned to vendor; Release to usable stock (passed re-inspection) | — |
| Quantity | number | Yes | Defaults to the full blocked quantity | Above 0 and not more than the blocked quantity. Stock held in quarantine by an open Quality NCR cannot be cleared here — it moves only through that NCR's disposition. |
| Remarks | text | No | e.g. scrap note no. / vendor return challan / QC report | — |

Saving posts a "Quarantine (out)" movement; for Release it also posts a "Return (in)" movement back to usable stock.

Opening Stock Import dialog (admin only; also needs Adjustments › Create):
- Loads stock already on the shelves at go-live or when a new store opens. Columns: item_code, warehouse (code or name), quantity, rate (book value per unit), batch_number, reference_number (e.g. OPENING-STOCK-2026), transaction_date (YYYY-MM-DD, blank = today), remarks.
- All-or-nothing: if any row has a problem, nothing is posted; the result lists Row, Item Code, Problem / Fix and how many other rows were fine. On success it lists Row, Item, Store, Type, Quantity.
- Buttons: **Download template**, **Import**, **Upload fixed file** / **Import another file**, **Done**.
- Each line posts a "Stock in" movement with entry type opening_stock.

### 3.3 Movements — /dashboard/store/movements

#### List view
Header "Stock Movements". Read-only ledger of every stock posting (GRN, issues, returns, transfers, adjustments, quarantine clears, opening stock, Quality moves). The server returns the latest 500 movements the user may see (data scope), newest first.

Quick tabs with counts: All, Receipts, Issues.

Filters: search ("Search item, store, vendor, invoice / doc no., batch…"), All stores, All categories, From date, To date; **Clear** button.

| Column | What it shows |
|---|---|
| Date | Transaction date. |
| Item | "Code — Name". |
| Store | Store name. |
| Type | Receipt, Issue, Return (in), Return (out), Transfer In, Transfer Out, Adjustment (+), Adjustment (-), Damage, Stock in, Stock out, Quarantine (in), Quarantine (out), Quality types, or the entry type label. |
| Quantity | Signed: "+" (green) for stock in, "−" (red) for stock out. |
| Batch | Batch number or "—". |
| Vendor | Vendor name or "—". |
| Invoice / Document | Document number with a small tag (PR, GRN, Issue, Return, Quarantine, Adjustment, Transfer, Entry, Work Order). For an old manual stock entry (SE-…) the number is a link that opens the stock entry dialog. |
| By | User who posted it. |

Stock entry dialog (old SE- entries): shows entry number, type, store, date, creator, vendor, invoice / challan, remarks, a lines table (Item, Qty, Batch, Rate, Value) and Documents. Documents can be opened; with Adjustments › Create, **+ Attach Document** adds files (PDF, images, Word, Excel, CSV, TXT). Documents can never be removed.

### 3.4 Adjustments — /dashboard/store/adjustments

#### List view
Header "Stock Adjustments". Button **+ New Adjustment** (needs Adjustments › Create).

| Column | What it shows |
|---|---|
| Adjustment # | SA-YEAR-NNNN. |
| Store | Store name. |
| Date | Adjustment date. |
| Status | Pending Approval (amber), Approved (green), Rejected (red). |
| Approver | Named approver / decider. |
| Items | Number of lines. |
| (action) | **View** link. |

Click a row or View to open the adjustment. The list follows the user's data scope; the approver of an adjustment always sees it.

#### Create form — New Stock Adjustment (/dashboard/store/adjustments/new)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Store * | dropdown | Yes | Stores the user may see | Changing the store resets the lines. Must be within the user's plant access. |
| Approver * | searchable dropdown | Yes | User directory (the current user is left out) | Cannot be yourself; must be an active user with Store access; must be a Store Manager (Store Manager flag on the user) or this store's own manager. |
| Reason | text | No | — | — |
| Remarks | multi-line text | No | — | — |
| Item (per line) | dropdown | Yes (at least one line) | All items | Disabled until a store is picked. Each item only once per adjustment. |
| Existing Qty (per line) | read-only | — | Current On Hand of the item at the store | — |
| Actual Qty (per line) | number | Yes | Physically counted quantity | Cannot be negative. The difference (Actual − Existing) is shown in green (+) or red (−). |

Buttons: **+ Add Item**, × (remove line), **Send for Approval**, **Cancel**. Saving records the count and the difference against the live balance; nothing is posted to stock yet. The adjustment date is today (cannot be in the future).

#### View page
Header: adjustment number and status pill (Pending Approval, Approved, Rejected, Withdrawn). **← Back**.
- Approval banner (pending, old-style adjustments): explains stock is unchanged until approval. The named approver (or an admin), who is not the creator, sees **Reject** (needs Adjustments › Reject; asks for a required reason) and **Approve & Post** (needs Adjustments › Approve; asks for confirmation). The creator sees "you can't approve an adjustment you created".
- Approval panel: adjustments raised since the move to the central approval engine show the shared Approval Panel (Organization › Approval Workflows) where approvers decide.
- Summary: Store, Adjustment Date, Approver / Approved By / Rejected By, Reason, Created By, Remarks, Rejection Reason (when rejected).
- Items table: Item, Qty at Count, Counted Qty, Difference (signed), Remarks.

#### Edit
Adjustments cannot be edited after sending. A rejected one must be raised again.

#### Statuses & workflow
1. Pending Approval — created; stock unchanged. Workflow "store.stock_adjustment": default stage is the Store Manager named on the adjustment, who must hold Adjustments › Approve. Self-approval is never allowed (four-eyes rule, also for admins).
2. Approved — each line's stored difference is posted ("Adjustment (+)" or "Adjustment (−)"), not re-calculated, so movements made after the count are kept. If posting fails (e.g. not enough stock) the approval is refused with the reason.
3. Rejected — reason stored ("Returned for changes: …" when returned via the engine). Nothing posted.
4. Withdrawn (cancelled via the engine).
- Notifications (bell) to the creator on approval or rejection (old path); the engine sends its own approval notifications.
- If the adjustment came from a Physical Count: approval closes the count (Posted); rejection / return / cancellation re-opens the count for a recount.

### 3.5 Reorder — /dashboard/store/reorder

#### List view
Header "Reorder" with an explanation: items whose projected stock — available plus what is already on order (open requisitions and POs) — is at or below their reorder level. Levels are set per item in the Item Master. Only active items that have a reorder level or a minimum stock are considered. Stock is summed over every store.

Filters: All categories dropdown; checkbox "Only items due for reorder" (on by default); a count "N due".

| Column | What it shows |
|---|---|
| (tick box) | Shown only on due rows and only if the user has the Procurement (p2p) app. |
| Item | Code — name (UOM). |
| Available | Free on-hand minus reserved, with the reserved quantity in brackets. |
| On order | Open PR lines with no PO yet plus open PO lines not yet received; hover lists the document numbers. |
| Projected | Available + On order; red when due. |
| Reorder level | From the item. |
| Min / Max | From the item. |
| Lead time | Purchase lead time in days. |
| Order qty | Editable number on due rows, pre-filled with the suggested quantity. |

Due rule: projected at or below the reorder level; if no reorder level, projected below minimum stock. Suggested quantity: top up to maximum stock if set; else the reorder quantity (repeated until above the reorder point); else the shortfall to the reorder level / minimum; rounded up to whole units and to multiples of the minimum order quantity. Rows are sorted with due items first, most short first.

Top button: **Raise PR for N selected** (only with the Procurement app; disabled until rows are ticked). Every ticked row needs an order quantity above 0. It opens the new Purchase Requisition form (/dashboard/p2p/new) pre-filled with the items (by Item Master id), make, quantities and a remark listing the item codes.

### 3.6 Physical Count — /dashboard/store/cycle-count

#### List view
Header "Physical Count" with explanation: counted items are frozen at that store while counting; differences go to a Store Manager for approval before stock changes.

| Column | What it shows |
|---|---|
| Count No. | PC-YEAR-NNNN. |
| Store | Store counted. |
| Date | Count date. |
| Scope | "All stocked items", "Category: X" or "N chosen item(s)". |
| Lines | "counted/total counted". |
| Status | Counting (stock frozen), Awaiting approval, Posted, Cancelled. |
| Adjustment | Adjustment number created on submit, or "—". |

Click a row to open the count. Users only see counts for stores within their plant access (latest 300).

#### Create form — Start a count (panel on the list page; needs Adjustments › Create)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Store * | dropdown | Yes | Stores | "Pick the store to count." |
| Category | dropdown | No | Categories ("All stocked items" = blank) | Lines = every item with Free stock above 0 at the store (in that category if picked). Error if nothing to count. |
| Blind count | checkbox | No | Ticked by default | Counters don't see book stock while counting. |
| Remarks | text | No | e.g. Year-end count 2026-27 | — |

**Start count** snapshots book stock and opens the count. It is refused if another open count at the same store already covers any of the same items.

#### View page
Header: count number, status pill, **Cancel count** (while counting, with Adjustments › Create; asks for a required reason), **← Back**.
- Summary: Store, Date, Scope, Counted (x/y), With difference (when visible), Adjustment link and status, Cancelled reason.
- While counting, a warning: these items can't be received, issued or transferred at this store until the count is submitted or cancelled; for a blind count, book stock is hidden and 0 must be entered for anything not found.
- Lines table: Item, UOM, Book ("hidden" for blind counts unless the user holds Adjustments › Approve), Counted (editable while counting), First count (shown when recounted), Difference (green +, red −), Remarks (editable).
- **Save counts** (enabled when something changed; quantities 0 or more). A recount keeps the first count.
- "Found something not on the list? Add item…" search + **Add to count** adds an active item (book = current on-hand, or 0).
- Submit count panel: "Store Manager to approve differences" (user directory, excluding yourself), Reason, **Submit count**. Every line must be counted first; unsaved counts must be saved first.

#### Statuses & workflow
1. Counting — stock of the counted items frozen at the store.
2. Submit with no differences → Posted at once (no approver needed).
3. Submit with differences → one Stock Adjustment (SA-…) is created for all differing lines, sent to the named Store Manager (same rules as Adjustments: not yourself, must be a Store Manager or the store's manager) → status Awaiting approval.
4. Adjustment approved → Posted (stock corrected). Adjustment rejected / returned / cancelled → back to Counting for a recount.
5. Cancelled — by reason while counting; nothing posted, items unfrozen.

### 3.7 GRN & Inspection — /dashboard/store/grn

GRNs are stored in the Procurement (P2P) module but worked from this Store page, because goods physically land in the store.

#### List view
Header "Goods Receipt (GRN) & Inspection". Button **+ New Goods Receipt** (needs GRN & Inspection › Create).

Bucket pills (with counts; the URL keeps ?bucket=):
- **Upcoming** — approved POs awaiting delivery (no GRN yet for the outstanding quantity).
- **Pending Inspection** — GRNs in draft.
- **Completed** — completed GRNs.
- **All** — every GRN.

Upcoming table:

| Column | What it shows |
|---|---|
| PO Number | Purchase order number. |
| PR Number | Purchase requisition number. |
| PO Date | PO date. |
| Vendor | Vendor name. |
| Expected Delivery | Expected delivery date. |
| Pending from Vendor | Per line: item name, pending quantity of ordered quantity and unit. |
| Status | Awaiting Delivery (issued / acknowledged) or Partially Received. |
| (action) | **Receive →** opens New Goods Receipt with that PO pre-selected. |

GRN table (other buckets):

| Column | What it shows |
|---|---|
| GRN Number | GRN-YEAR-NNNN. |
| PO Number / PO Date | Linked purchase order. |
| Vendor | Vendor name. |
| Received Date | Date goods arrived. |
| Status | Pending Inspection (draft), Completed, Reversed. |
| (action) | **View**. |

#### Create form — Record Goods Receipt (/dashboard/store/grn/new)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Purchase Order * | searchable dropdown | Yes | POs awaiting receipt ("PO no. — vendor (PR no.)") | PO must be Issued, Acknowledged or Partially Fulfilled and pass PO approval checks. |
| Store Location | dropdown | No | Stores ("-- None --" allowed) | Store users can receive only into their own plant's stores; Purchase users are cross-plant. |
| Received Date * | date | Yes | Defaults to today | — |
| Received Now * (per line) | number | At least one line above 0 | Line table shows Item, Unit, Ordered Qty, Already Received, Pending | Must be above 0 and not more than pending. Shows "Short by X — stays pending from vendor" or "More than pending". Every PO line must be linked to an Item Master item (else "use Link to Item Master on the PO"). |
| Remarks | multi-line text | No | Delivery note reference, condition on arrival | — |

Buttons: **Fill pending qty** (fills every line with its pending quantity), **Save Goods Receipt** (enabled once a PO is picked), **Cancel**, **← Back**. Only Store or Purchase users (or admins) can use the form.

On save: GRN created in draft (Pending Inspection), every line "pending". Lines of items with "Inspection on receipt" go to Quality stock with an incoming inspection lot (line shows "In Quality inspection"). The PO creator gets a bell notification "Goods Receipt Recorded" (or "— Short Supply" listing what the vendor still owes); the PR audit trail records the receipt and any short supply.

#### View page — /dashboard/store/grn/[grn]
Header: GRN number. Buttons: **↩ Return to Vendor** (needs GRN › Create, GRN not reversed, at least one decided line with accepted or rejected quantity left), **Reverse GRN** (needs inspection rights — see below — GRN not reversed and no returns yet), **← Back**.

- Reversed banner (when reversed): reason, who and when; stock was taken back out.
- "Stock was not fully updated" box (after inspection, when the server reports problems) with a **+ Add Item to Item Master** button.
- Header info: PO Number, PR Number, Vendor, Received Date, Store Location, Received By, Inspected By (when completed), Remarks.
- Quality Inspection / Inspection Result table:

| Field | Meaning |
|---|---|
| Item | Item name (unit). |
| Ordered / Received | Quantities. |
| Accepted / Rejected | Editable numbers on pending lines for inspectors; otherwise the recorded split. |
| Returned | Quantity already returned to vendor (accepted / rejected). |
| Quality Status | Editable (Passed, Failed, Partially Accepted) on pending lines; otherwise the result or "In Quality inspection". |
| Rejection Reason | Editable when not Passed; for Quality-lot lines shows the lot note. |

- **Complete Inspection** — shown to users with GRN › Approve AND (admin or the Purchase app). Rules: accepted + rejected must equal received; Passed means 0 rejected; Failed means 0 accepted; Partial needs both. Lines in a Quality lot can't be inspected here (the lot decides). Every line must be decided.
- Store-only users see "Inspection is completed by the Purchase/QC team".

Return to Vendor form (inside the page):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Return accepted (per line) | number | One line at least | Up to "Accepted left" | Accepted goods leave Free stock at the PO rate. |
| Return rejected (per line) | number | One line at least | Up to "Rejected left" | Records that rejected goods (never in stock) went back. Material rejected by a Quality lot must go back through its NCR instead. |
| Reason * | dropdown | Yes | Rejected in inspection; Damaged in transit / on receipt; Wrong item supplied; Excess quantity supplied; Other | — |
| Return Date | date | No | — | Not before the received date. |
| Vehicle No. | text | No | — | — |
| Remarks | text | Required when reason is Other | — | — |

**Save Return** creates RTV-YEAR-NNNN: stock out, the PO is opened again for the replacement, and if the vendor's invoice already covers the goods a pending debit note is raised for Finance (the message says which). A "Returns to Vendor" list then shows each RTV: number, date, reason, value, vehicle, by, items, debit note message, remarks.

Reverse GRN: asks for a required reason. Only for a GRN entered by mistake (wrong PO / quantity / store). Allowed only for Purchase-app users, when nothing went through a Quality lot, nothing was returned, and the vendor invoice does not already cover the goods. Accepted stock is taken back out at the PO rate and the PO / PR become open again.

#### Statuses & workflow
1. Pending Inspection (draft) — after recording.
2. Completed — when every line is decided (by Complete Inspection, or by Quality lot usage decisions). Accepted quantity posts to the store; PO and PR receipt status roll up (partially fulfilled / fulfilled; PR partially received / received).
3. Reversed — by Reverse GRN.
Related document: Return to Vendor (RTV) with optional debit note.

### 3.8 Returns — /dashboard/store/returns

#### List view
Header "Material Returns". Button **+ New Return** (needs Returns › Create).

| Column | What it shows |
|---|---|
| Return # | MR-YEAR-NNNN. |
| Store | Store the material comes back to. |
| Source | Source issue number, source description or source type. |
| Date | Return date. |
| Items | Number of lines. |
| Status | Pending Approval, Approved, Rejected — with "· your action" when the user can decide it. |
| (action) | **View**. |

#### Create form — New Material Return (/dashboard/store/returns/new)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Store * | dropdown | Yes | Stores | — |
| Source * | dropdown | Yes | Return sources: "Against a Material Issue", "Other (no issue reference)" | — |
| Material Issue * | dropdown | Yes when the source requires an issue | Material issues (number — department) | Picking it pre-fills the department. The issue must be from the same store. Only items on that issue, and not more than issued minus already returned (rejected returns don't count). |
| Source Description | text | No (shown when no issue needed) | e.g. Site surplus return | — |
| Department | dropdown | Required when a department-head approval applies (a Damaged line) | Departments | — |
| Reason | text | No | — | — |
| Remarks | multi-line text | No | — | — |
| Item (per line) | searchable dropdown | At least one line | Items | — |
| Quantity (per line) | number | Yes | — | Above 0. |
| Condition (per line) | dropdown | Yes | Good — to usable stock; Damaged — to quarantine; Rejected (quality) — to quarantine | — |
| Batch # (per line) | text | No | — | — |

Approval preview box: shows who must approve by default (Store in-charge for "Other" source; Department head for Damaged lines; Designated approver for Rejected (quality) lines) or "No approval needed — stock updates as soon as you record this return", and how many lines go to quarantine. Save button reads **Submit for Approval** or **Record Return**. Return date is today (no future dates).

#### View page — /dashboard/store/returns/[return]
Opens for any logged-in user (approvers such as department heads may have no Store access); the server decides access. The Store sub-nav shows only for Store users.
- Header: return number, status pill (Pending Approval, Approved, Rejected, Withdrawn); **Reject** (reason required) and **Approve** buttons when the user can act; **← Back**.
- Rejected banner with the reason.
- Summary: Store, Source, Material Issue / Source Description, Department, Return Date, Returned By, Reason, Remarks.
- Approval Panel (central approval engine).
- "Approvals (raised before Approval Workflows)" list for older returns: each step label, approvers, decision, who, date, comment.
- Items: Item, Quantity, Condition (green for Good, amber otherwise), Batch, Remarks.

#### Statuses & workflow
1. Pending Approval — routed by workflow "store.material_return" (Organization › Approval Workflows). Default stages, each applying only when used: "Other" source → manager of the return store; Damaged line → head(s) of the department the material was issued to; Rejected (quality) line → designated users (or the store manager). Any one approver of a stage decides it. The creator can never approve. Approvers do not need a Store permission.
2. If no stage applies, the return is approved and posted immediately.
3. Approved — Good lines post "Return (in)" to usable stock; Damaged / Rejected lines post "Quarantine (in)" (Blocked). Usable material coming back from a job-work issue (vendor) for an inspection-controlled item goes to Quality stock under a job-work inspection lot instead.
4. Rejected — nothing posted; bell notification to the person who raised it (old path).

### 3.9 Issues — /dashboard/store/issues

#### List view
Header "Material Issues". Button **+ New Issue** (needs Issues › Create). Visible to users with Issues › View or Returns › Create (the return form picks from this list), within their data scope.

| Column | What it shows |
|---|---|
| Issue # | MI-YEAR-NNNN. |
| Purchase Requisition | PR number (blue link to the PR) when the issue was made from a PR. |
| Store | Store issued from. |
| Issue Type | Type label. |
| Challan No. | Delivery challan number. |
| Vendor | Job-work vendor. |
| Department | Department. |
| Project / WO | Work order / reference. |
| Requested By / Issued By | Users. |
| Date | Issue date. |
| Items | Number of lines. |
| (action) | **View**. |

#### Create form — New Material Issue (/dashboard/store/issues/new)

Fixed fields:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Store * | dropdown | Yes | Stores | Changing it reloads live stock. |
| Issue Type * | dropdown | Yes | Issue types (fixed list, see below) | Changing it clears the type fields. |
| Remarks | multi-line text | Required for Scrap / Disposal ("Reason for scrapping / disposal") | — | — |

Type-specific fields (the form shows only the picked type's fields; the server validates the same standard and clears fields that don't belong to the type):

| Issue type | Fields (required unless noted) | Extra rules |
|---|---|---|
| Production | Work order no. (optional) | — |
| Maintenance | Maintenance work order OR Machine / asset (at least one) | — |
| Project / Site | Project / machine (order); Site address (optional); Returnable? (optional); Expected return date (if returnable = Yes); Delivery challan no.; Vehicle / courier no. (optional) | Leaves the factory — travels on a delivery challan. |
| General / Office | Department | — |
| Rework | NCR OR Work order no. (at least one) | — |
| Testing | Inspection lot OR NCR (at least one); Destructive test?; Expected return date (if not destructive) | — |
| Job Work / Subcontracting | Vendor; Process (Machining, Plating / Coating, Heat treatment, Fabrication / Welding, Testing at outside lab, Other); Expected return date; Delivery challan no.; Vehicle / courier no. (optional) | Leaves the factory. The vendor name is kept on the issue. |
| Scrap / Disposal | Scrap buyer (optional); Delivery challan no. (if a buyer is entered); Vehicle / courier no. (optional); Remarks required | Write-off: only a Store Manager, the store's manager or an admin can post it. |
| Customer Sample / Trial | Customer; Purpose (Sample / Trial); Returnable?; Expected return date (if returnable); Delivery challan no.; Vehicle / courier no. (optional) | Leaves the factory. |
| Dispatch to customer | Project / machine (order); Delivery challan no.; Transporter, Vehicle / courier no., LR no. (optional) | Quality rule 8: each finished-goods line needs batch / serial and an accepted final inspection, plus an accepted third-party inspection certificate when the order needs one; otherwise "Dispatch blocked by Quality". |

Field types: pick-lists (department, maintenance work order, asset, NCR, inspection lot, customer, vendor) are searchable dropdowns; Project / machine is a searchable list of ERP projects (marked "inspection required" for dispatch where applicable); Yes/No fields are dropdowns; dates use the date picker; challan number max 50 characters; expected return date cannot be before today.

Items section:
- Status line: live stock of the picked store with update time (auto-refresh every 30 seconds) and **↻ Refresh stock**.
- **Import from Excel** (.xlsx, .xlsm, .csv; columns item_code, quantity, batch_number, remarks; max 1000 rows) adds lines; skipped rows are listed with reasons. **Download template** gives material_issue_lines_template.xlsx.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item | searchable dropdown | At least one line | Items | — |
| Quantity | number | Yes | — | Above 0. |
| Available in store | read-only | — | Free stock minus reservations | Shows "Not in stock" or "Short by X" in red (summed over all lines of the same item), reserved and on-hand, and quantity held in Quality / Blocked. |
| Batch # | text | No | — | — |
| Remarks | text | No | — | — |

When lines are short, a red banner offers **Issue only what's available** (caps lines to available stock) and **Remove short lines**. The form refuses to save while short lines remain. Buttons: **+ Add Item**, × per line, **Issue Material (N lines)**, **Cancel**, **← Back**.

On save the issue posts immediately: each line posts an "Issue" movement from the store. The server refuses if stock is not enough, the item is frozen by an open physical count, or a type rule is missed.

#### View page — /dashboard/store/issues/[issue]
Header: issue number, **← Back**. Summary shows: Store, Issue Type, Department, Work Order / Reference, Against (linked record), Challan No., Expected return, Returnable, Destructive test, Purpose, Site, Transport (transporter, vehicle, LR), Scrap buyer — each only when filled; Issue Date, Requested By, Issued By; Purchase Requisition link; Remarks. Items table: Item, Quantity, Batch, Remarks.

#### Edit / Statuses & workflow
Issues post at once and have no status, approval, edit or cancel action in the UI. Unused material comes back through a Material Return.

### 3.10 Transfers — /dashboard/store/transfers

#### List view
Header "Stock Transfers". Button **+ New Transfer** (needs Transfers › Create). Status filter pills with counts: All, Pending approval, To dispatch, In transit, Received, Rejected, Cancelled.

| Column | What it shows |
|---|---|
| Transfer # | ST-YEAR-NNNN. |
| From / To | Sending and receiving stores. |
| Date | Transfer date. |
| Items | Number of lines. |
| Status | Status pill. |
| (action) | **View**. |

A plant-scoped user sees transfers sent from or received into their plants.

#### Create form — New Stock Transfer (/dashboard/store/transfers/new)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| From Store * | dropdown | Yes | The user's own stores | — |
| To Store * | dropdown | Yes | Stores of every plant (inter-unit transfers allowed) | Must differ from From Store; must be active. |
| Reason | text | No | — | — |
| Remarks | multi-line text | No | — | — |
| Item (per line) | searchable dropdown | At least one line | Items | The same item + batch only once. |
| Quantity (per line) | number | Yes | — | Above 0; total per item must be available at the sending store (free minus reserved). |
| Batch # (per line) | text | No | — | — |

Button **Submit for Approval**. Nothing moves yet.

#### View page — /dashboard/store/transfers/[transfer]
- Header: transfer number, status pill; buttons **Dispatch** (status Approved and Transfers › Edit), **Confirm Receipt** (status In transit and Transfers › Edit), **Cancel Transfer** (status Pending approval or Approved, and the user raised it or holds Transfers › Delete), **← Back**.
- Progress bar: 1. Approval → 2. Dispatch → 3. In transit → 4. Received.
- Rejected banner with reason.
- Summary: From Store, To Store, Transfer Date, Reason, Raised By, Approved By (with time); after dispatch: Dispatched (who, when), Vehicle / Transporter, Driver / E-way Bill; after receipt: Received (who, when), Receipt Remarks; Remarks.
- Approval Panel while pending (and after rejection).
- Items: Item, Quantity, Batch, Remarks.
- Stock Transfer Note card (see section 6).

Dispatch dialog: Vehicle Number, Transporter, Driver Name, Driver Phone, E-way Bill Number (all optional; vehicle stored uppercase). Dispatch posts "Transfer Out" from the sending store (availability re-checked).

Confirm Receipt dialog: Remarks (optional). Posts "Transfer In" at the dispatched quantities and value into the receiving store (user must have access to that store). Shortages or damage are handled afterwards with a Stock Adjustment at the receiving store.

#### Statuses & workflow
1. Pending approval — workflow "store.stock_transfer": default stage is the manager of the sending store; if the store has no manager, users holding Transfers › Approve. No self-approval.
2. Approved — to dispatch. Bell notification to the person who raised it.
3. In transit — after Dispatch. Bell notification to the receiving store's manager.
4. Received — after Confirm Receipt. Bell notification to the person who raised it.
5. Rejected (reason kept) or Cancelled (before dispatch, no stock moved).

### 3.11 Reservations — /dashboard/store/reservations

#### List view
Header "Stock Reservations". Button **+ New Reservation** (needs Reservations › Create).

| Column | What it shows |
|---|---|
| Reservation # | RES-YEAR-NNNN. |
| Item | Code — name. |
| Store | Store. |
| Quantity | Reserved quantity and unit. |
| Project / PO | Project and production order. |
| Required Date | Date needed. |
| Status | Active, Fulfilled, Cancelled. |
| (actions) | On Active rows with Reservations › Edit: **Fulfill** (confirm: releases the earmark, assuming the material was issued separately — does not reduce stock) and **Cancel** (confirm: releases the reserved quantity back to available). |

#### Create form — New Reservation (pop-up)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Item * | dropdown | Yes | Items | — |
| Store * | dropdown | Yes | Stores | — |
| Quantity * | number | Yes | — | Above 0; must not exceed available stock (on hand minus already reserved). |
| Project | text | No | — | — |
| Production Order | text | No | — | — |
| Required Date | date | No | — | — |
| Remarks | multi-line text | No | — | — |

Button **Reserve Stock** adds the quantity to the balance's Reserved column (reducing Available).

#### Statuses & workflow
Active → Fulfilled (Fulfill) or Cancelled (Cancel); both release the reserved quantity. No approval.

## 4. Settings / Masters

The Settings group opens /dashboard/store/settings, which redirects to the first section the user may view. A pill row (StoreSettingsNav) shows: Item Types, Units of Measure, Categories, Stores, Issue Types.

### Item Types — /dashboard/store/settings/item-types
- Table: Name, Code Prefix, Edit / Delete links. Button **+ Add Item Type** (Item Types › Create); Edit (Item Types › Edit); Delete (Item Types › Delete).
- Form: Name * (max 100, unique), Code prefix (max 6, letters/digits, uppercase; blank = auto from initials; must be unique). The prefix starts every new item code of the type; changing it affects only new items.
- Delete is refused for the default type (Material), for a type used by items or categories, or the last remaining type.
- Seeded types: Material (MT), Service (SV), Asset (AS), Consumable (CN), Tool & Equipment (TE).

### Units of Measure — /dashboard/store/settings/uoms
- Table: Code, Name, Edit / Delete. Button **+ Add Unit** (UOMs › Create).
- Form: Unit code * (max 20, uppercase, unique), Unit name (max 100). Units are shared by Store items and Purchase Request lines.
- Renaming a code moves items to the new code, but once a code is used on an item or a PR / PO / GRN line only its name can change. Delete is refused when used, or for the last unit.
- Seeded units include NOS, PCS, SET, PAIR, KIT, LOT, KG, GM, TON, MTR, MM, CM, FT, INCH, SQM, SQFT, CUM, LTR, ML, BOX, PKT, ROLL, BAG, DRUM, CAN, BTL, SHEET, COIL, BUNDLE, HR, DAY, JOB.

### Categories — /dashboard/store/categories
- Table: Name (subcategories indented with ↳), Code, Item Type ("All types" when none), Parent, Purchase Ledger (top-level only; "Finance default" when not set), Status, Edit / Delete. Button **+ Add Category**.
- Form: Name *; Code (blank = auto from initials, made unique; fixed once created); Parent Category (blank = top-level; picking one makes a subcategory; fixed once created); Item Type (top-level only; subcategories follow it); Purchase ledger and Sales ledger (top-level only — every item in the category books to these unless the item sets its own; blank = Finance default); Active (edit only).
- Name must be unique at its level; ledgers can't be set on a subcategory. Delete is refused if the category has subcategories or items (untick Active instead).
- The category code is used in item codes. Seeded categories per type, e.g. Material: Raw Material (RAW), Production Material (PRD), Electrical (ELE), Hydraulic & Pneumatic (HYD), Mechanical Components (MEC), Hardware & Fasteners (HWF), Paint & Chemicals (PNT), Packaging (PKG); Service: Job Work, Maintenance Service, Professional Service, Consultancy, Other Service; Asset: Machinery, Equipment, Vehicle, IT Asset, Furniture; Consumable: Office Consumables, Cleaning, PPE, Workshop Consumables, Production Consumables; Tool & Equipment: Hand Tools, Power Tools, Measuring Instruments, Testing Equipment, Engineering Tools.

### Stores — /dashboard/store/locations
- Table: Name, Code, Branch, Type, Status, Delete link. Button **+ Add Store** (Stores › Create).
- Form (Add Store): Name *, Code * (unique), Branch (plant), Store Type (free text, e.g. Raw Material, Finished Goods), Address.
- Non-admins can create stores only in their own plant. Only an admin can set or change a store's manager or move it to another plant (no edit screen exists on this page).
- Delete is refused when the store has any issues, returns, adjustments, transfers, reservations, GRNs, PR lines, maintenance spares, production work orders or hydraulic service parts — set it Inactive instead. An inactive store cannot receive stock.

### Issue Types — /dashboard/store/settings/issue-types
- Table: Name, Status, Edit. The list is fixed in code: Production, Maintenance, Project / Site, General / Office, Rework, Testing, Job Work / Subcontracting, Scrap / Disposal, Customer Sample / Trial, Dispatch to customer.
- Types cannot be added, switched off or deleted. Only an unrestricted user (admin) can rename one. What each type asks for is fixed (see 3.9).

### Other settings (no screen)
- Return sources and return conditions (with their default approvers) are fixed in code; approvers are set in Organization › Approval Workflows › Material return.
- Valuation settings (registered in the shared settings framework, no Store UI): Weighted-average valuation on, Valuation cut-over date, Require a rate on manual receipts, Allow negative stock (locked off).

## 5. Permissions

Opening any Store page needs access to the Store app. Tabs and buttons then follow the role permission matrix (module "store"; permission id store:tab:action). Data scope: Store documents are scoped by the store's plant (Own, Plant, Multiple plants or All, per Organization › Role & Permissions).

| Tab key | Name | Actions |
|---|---|---|
| items | Items | view, create, edit, delete, export, import |
| stock | Stock (also gates Reorder) | view, export, print |
| movements | Movements | view, export, print |
| issues | Issues | view, create, edit, delete, export, print |
| reservations | Reservations | view, create, edit, delete |
| adjustments | Adjustments (also gates Physical Count) | view, create, edit, delete, approve, reject, export, print |
| returns | Returns | view, create, edit, delete, approve, reject, export, print |
| transfers | Transfers | view, create, edit, delete, approve, reject, export, print |
| grn | GRN & Inspection | view, create, edit, delete, approve, reject, export, print |
| project_work | Ongoing Projects | view, edit |
| settings | General settings | view, edit |
| item_types, uoms, categories, warehouses, entry_types, issue_types, issue_rules | Settings masters | view, create, edit, delete |

Key rules:
- Item / stock / store / category / UOM / item-type lookups are open to any user with any module, so other modules' pickers work.
- Opening Stock Import: admin only (plus Adjustments › Create). Clear Quarantine and attaching stock-entry documents: Adjustments › Create.
- Adjustment / physical-count approver must be a Store Manager (Store Manager flag on the user) or the store's own manager, never the creator.
- GRN: record = GRN › Create (Store or Purchase app); inspect = GRN › Approve plus Purchase app or admin; reverse = GRN › Approve plus Purchase app; Return to Vendor = GRN › Create. Users with the Purchase app automatically keep store:grn view/create/approve.
- Transfers: dispatch and receive = Transfers › Edit; cancel = the raiser or Transfers › Delete; approval by the sending store manager or Transfers › Approve holders.
- Scrap / Disposal issue: Store Manager, the store's manager or admin.
- Material Return view page: any logged-in user may open it; approvers need no Store permission.
- Reorder "Raise PR" needs the Procurement (p2p) app.
- Store and settings: only an admin can set a store's manager or plant; only an admin can rename fixed issue types.

## 6. Documents, Notifications & Integrations

Documents:
- **Stock Transfer Note** — managed Word document (entity store_stock_transfer_note), available once a transfer is approved. **Save & Edit in Word** (primary, needs Transfers › Edit) and **Print / Download PDF** (secondary). It refreshes after dispatch (vehicle details, revision 1) and after receipt (revision 2). Sent with the material and signed by the receiving store.
- Excel exports: Item Master, Stock. Templates: item import (CSV), opening stock import (CSV), material issue lines (Excel).
- Item photos stored in SharePoint (Store-Items folder).
- Return to Vendor can raise a pending **debit note** for Finance.
- Document numbers: MI- (issue), MR- (return), ST- (transfer), SA- (adjustment), PC- (physical count), RES- (reservation), GRN-, RTV- — each per year.

Notifications (bell):
- Goods Receipt Recorded / Goods Receipt Recorded — Short Supply → PO creator.
- Stock Adjustment Approved / Rejected → adjustment creator (old named-approver path).
- Material Return Approved / Rejected → person who raised it (old path).
- Stock Transfer Approved → raiser; Stock Transfer Dispatched to Your Store → receiving store manager; Stock Transfer Received → raiser.
- Central approval engine (Organization › Approval Workflows) notifies approvers of pending adjustments, returns and transfers.

Links to other modules:
- Procurement (P2P): PR lines, PO lines and GRN lines carry the Item Master id; GRN, RTV and reversal update PO / PR receipt status; Reorder pre-fills a new PR; issue rows link to their PR; vendor suggestions use PO history and vendor catalogs.
- Quality: Inspection on receipt creates incoming inspection lots (Quality stock); lot decisions complete GRN lines; NCR-held Blocked stock moves only through NCR dispositions; job-work returns create job-work lots; Dispatch issues are checked against final inspection and third-party certificates; Testing / Rework issues reference lots and NCRs.
- Finance: vendor master shared with Procurement; GST rate master; purchase / sales ledgers on item and category; weighted-average valuation on stock movements; debit notes from RTVs.
- Production / Engineering: purchase lead time and minimum order quantity feed MRP and the long-lead list; items used in BOMs and work orders cannot be deleted.
- Maintenance: Maintenance issues reference work orders and assets.
- ERP Projects / Customers (CRM): Project / Site, Dispatch and Customer Sample issues reference projects and customers.
- Organization: branches (plants) for stores, departments, user directory for approvers, Approval Workflows, Role & Permissions.
- Ongoing Projects: the old Store project-work link forwards to /dashboard/ongoing-projects.
