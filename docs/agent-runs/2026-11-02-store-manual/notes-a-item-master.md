# Store manual notes A: Item Master and Store Settings

Verified against code on 2026-11-02 (frontend pages/components, backend routes, services, permission registry). The tour configs `frontend/src/lib/tour/configs/store*.ts` are stale in several places; see section 8.

Short glossary used below: "tab permission" = Role editor row under Store (module > tab > action). "Feature" = finer switch under a tab (module > tab > feature > action).

---

## 1. Screen map

Store top bar (StoreNav): groups Inventory / Inward / Outward, plus the Settings gear next to the bell (tooltip "Store settings") and the tour "?" icon. Inventory pills: Item Master, Stock, Batches, Bins, Serial Nos., Movements, Adjustments, Reorder, Physical Count. A pill/page shows only if the user has View on its tab.

| Screen | URL | Purpose | Permission needed |
|---|---|---|---|
| Item Master (list) | `/dashboard/store` | List, search, filter, export, import items | Store app + tab `items` view. Buttons: Export = `items:export`, Import = `items:import`, "+ Add Item" = `items:create` |
| Add Item | `/dashboard/store/new` | Create an item | `items:create` (API `POST /store/items`; the code preview `GET /store/items/next-code` also needs create) |
| Item detail / view | `/dashboard/store/<signed ref>` (opened by clicking a row; link is a signed reference, an edited link shows "Invalid link") | Read all facts of an item; photo; Plant data; Vendors panel | Store app. Edit button needs `items:edit`; Delete needs `items:delete` (`canDelete`, "Items carry no creator, so anyone holding Items > Delete may delete") |
| Edit Item | same URL, "Edit" button switches the page into the Edit form (no separate URL) | Change an item | `items:edit` |
| Settings landing | `/dashboard/store/settings` | Only redirects to the first Settings section the user may view | any of the Settings tabs |
| Item Types | `/dashboard/store/settings/item-types` | Master list of item types | tab `item_types`: view; create = "+ Add Item Type"; edit = Edit link; delete = Delete link |
| Units of Measure | `/dashboard/store/settings/uoms` | Master list of units | tab `uoms` (view/create/edit/delete) |
| Categories | `/dashboard/store/categories` (old URL kept) | Categories and subcategories per item type | tab `categories` |
| Stores | `/dashboard/store/locations` (old URL kept) | Store locations (warehouses) per plant | tab `warehouses` ("Stores (locations)") |
| Issue Types | `/dashboard/store/settings/issue-types` | Why material is issued (fixed list; rename only) | tab `issue_types` |
| Issue Rules | `/dashboard/store/settings/issue-rules` | RETIRED: redirects to Store Settings | none |
| Entry Types | `/dashboard/store/settings/entry-types` | RETIRED: redirects to Store Settings | none |

Settings pills (StoreSettingsNav), in order: Item Types, Units of Measure, Categories, Stores, Issue Types. Each pill shows only if the user can view that Settings tab. Roles list also still contains tabs "General settings" (`settings`), "Stock Entry Types" (`entry_types`) and "Issue Rules" (`issue_rules`) under the Settings group, but no screen uses entry_types/issue_rules any more (see section 8).

Empty folders `store/items`, `store/item-master`, `store/stock-items`, `store/warehouses` exist but contain no pages: they are not screens.

Master-data lookups (item list API, categories, stores, UOMs, item types) are readable by anyone who can open at least one portal module (so Purchase and Production users can pick items without Store rights). Store Stores list is further limited to the user's plant(s) by data scope.

Features under tab Items (Role editor, "features"):
- "Plant data (MRP per plant)" (section; view, edit): the Plant data block on the item page.
- "Who can supply this item" (section; view): the "Vendors for this item" block.
- "Stock value & rates" (sensitive; view): weighted average and last receipt rate. Without it those show blank. Standard cost stays visible to anyone with `items:edit`.

---

## 2. Item list (Item Master)

Header: title "Item Master". Right side buttons, in order: **Export**, **Import**, **+ Add Item** (each hidden without the permission).

Filter row:
- Search box, placeholder "Search code, name or specification". Live search (no Enter needed). Every typed word must match (any order) in item name, code, legacy code, part code, technical specification or category. With a search, rows whose NAME matches come first (exact, starts with, contains), then code matches, then the rest.
- Type dropdown: first option "All Types", then the item types from Settings.
- Category dropdown: appears only after a type is picked; "All Categories" plus that type's top-level categories.
- Subcategory dropdown: appears only when the picked category has subcategories; "All Subcategories".
- "Clear filters" text button appears when any search/filter is set. Changing the type resets category and subcategory.
- There is NO Status filter on this page: all items (Active, Inactive, Discontinued) are listed together.

Table columns (left to right): Code (with a small row-count chip), Type, Category, Subcategory, Name, UOM, Technical Specification (cut with "..." if long, hover shows full text), Status (pill: Active in green, Inactive/Discontinued in grey; underscores shown as spaces).
Default order: by Item Code ascending, but it is a TEXT sort, so with codes 01..99 and 100+ you will see "100" between "10" and "11" (see section 8).
There are no counters/count cards on this page (only the row-count chip on the Code header).

Empty states: "No items yet — use + Add Item to create the first one." (no filters) or "No items match these filters." Loading: "Loading…". Load failure dialog: title "Failed to Load Items" with a Reload button. Export failure dialog: "Export Failed" ("Export failed." or the server reason).

Opening a row: click anywhere on the row; opens the item detail page.

Export: downloads `item_master[_<type>]_<yyyy-mm-dd>.xlsx` containing exactly what the list shows (same search and filters). Sheet "Item Master", header row frozen, auto filter. Columns: Item Code, Item Type, Category, Subcategory, Item Name, UOM, Technical Specification, Status, Lead Time (days), Legacy Code, Part Code, HSN / SAC, GST %, Preferred Vendor (shows vendor CODE), Standard Cost (blank if the user may not see it), Min Order Qty, Reorder Level.

Import: see section 5. No other bulk actions exist on this page (no multi-select, no bulk delete, no bulk status change).

---

## 3. Add Item form

Page title "Add Item", subtitle on screen: "A new Item Master record — the code is assigned on save from type + category." (WRONG, see section 8). Top-right "← Back" returns to the list. Footer buttons: **Cancel** and **Save Item** (shows "Saving…"). A blue strip "Your unsaved data from <time> was filled back in — check it and save." with a **Discard** button appears if a draft was restored (forms keep a draft automatically; cleared after a successful save). Errors appear in a dialog titled **"Cannot Save Item"**. Required fields carry a red star; optional ones say "(optional)".

Layout is two columns: left = Item Details, Planning, Purchasing, Tax & Accounts, Stock Levels & Cost, Quality & Tracking; right = Item Code, Photo.

### 3.1 Right column

**Item Code** (read only, grey): shows the next number, e.g. `01` for an empty master. Helper text: "Assigned automatically when you save — the next running number. Numbers are never reused." Tooltip: "Assigned automatically when you save — the next running number (01, 02 … 100 …)".
- Rule (service.generate_item_code): ONE global running number for all items, no type or category in it. At least 2 digits (01 ... 99, 100, 101 ...). The last number issued is stored in the number series "STORE/ITEM", so a deleted item's number is never handed out again. It also never goes below the highest plain numeric code already in the master (typed by hand or imported earlier). The preview is not reserved: if two people save at the same time, each gets a distinct number and the one shown may differ.
- Cannot be typed in the form. It is fixed after creation ("Fixed once created." on Edit).
- Old items may still carry old-style codes like `MT-HYD-0001` (the code search covers them).

**Photo** (optional): box "+ Add photo / JPG / PNG, up to 5 MB". Click to choose; after choosing, links **Change** and **Remove** appear. On Add Item the file is only held until you click Save Item; then it is uploaded. If the upload fails the item is still saved and a dialog "Photo Not Uploaded" says: "Item <code> was saved, but the photo couldn't be uploaded: <reason> You can add it from the item page." Checks: must be an image ("'<file>' isn't an image — pick a JPG, PNG or WEBP photo."), max 5 MB ("The photo is X MB — keep it under 5 MB."). Server may say "Photo storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID." (503).

### 3.2 Item Details section

| # | Label | Required | What to enter / behaviour | Example |
|---|---|---|---|---|
| 1 | Item Type | no (defaults to Material) | Searchable pick from Settings > Item Types ("Select item type…"). Picking a different type CLEARS Category and Subcategory. Pick-only; types are added in Settings. | Material |
| 2 | Category | optional | Lists only top-level categories of the picked type, first option "— None —". Placeholder "Select category…", or "No categories for this type — add one in Settings". Disabled "Pick an item type first" if no type. Changing it clears Subcategory. Inactive categories are NOT hidden in this list (see section 8). | Raw Material |
| 3 | Subcategory | optional | Enabled after a category is chosen; lists that category's subcategories ("— None —", "Select subcategory…" or "No subcategories — add one in Settings"). | (blank) |
| 4 | Item Name | **required** | Full descriptive name incl. size/grade. Up to 200 characters stored. Placeholder "Mild Steel Rod 12mm". | Mild Steel Rod 12mm IS 2062 |
| 5 | UOM | **required** | Searchable pick of unit codes ("Select unit…"); shown as `KG — Kilogram`. Pick-only here (add units in Settings > Units of Measure). Saved in UPPER CASE. | KG |
| 6 | Technical Specification | optional | Free text: grade, standard, dimensions, make. This also is what import duplicate checks compare with the name. | IS 2062 E250, 12 mm dia, 6 m length |

Category/Subcategory are stored on the item by NAME (text), not id. Renaming a category in Settings renames it on all items that use it.

Validation (front end first, then dialog "Cannot Save Item"): "Item Name is required." and "Pick the unit of measure (UOM)." Server texts: "Enter the item name." / "Pick the unit of measure (UOM) for this item." / "'<x>' isn't a unit in the list. Pick one from the UOM dropdown, or add it there with '+ Add unit'." / "'<x>' isn't a valid item type. Choose one of: ...".
Note: category is NOT required by the server, even though item types have a fixed standard list.

### 3.3 Planning section

| Label | Required | Entry | What it affects |
|---|---|---|---|
| Purchase lead time (days) | optional | Whole number 0 to 730, calendar days from PO to goods in store. Placeholder "e.g. 21". | Production MRP and Engineering long-lead list. If blank, item page says "Not set — MRP will assume one". |
| Legacy code | optional | Up to 50 characters; code from the old v3 sheet or Tally; placeholder "v3 / Tally code". Must be unique (case-insensitive). Searchable in the list. | Reference only |

Helper text: "Lead time = calendar days from PO to goods in store. Used by MRP and the Engineering long-lead list."
Errors: "Purchase lead time '<v>' isn't a number — enter whole calendar days from PO to goods in store, e.g. 21." / "Purchase lead time must be whole days — <n> has a fraction; round it to full days." / "Purchase lead time must be between 0 and 730 calendar days — <n> is outside that range." / "Legacy code can be at most 50 characters — '<first 20>…' has <n>; shorten it." / "Legacy code '<c>' is already used by <code> '<name>' — each legacy code can belong to one item only." (409).

### 3.4 Purchasing section

| Label | Required | Entry | Affects |
|---|---|---|---|
| Preferred vendor | optional | Searchable pick from the shared vendor master (only active vendors); first option "— No preferred vendor —", placeholder "Pick from the vendor master". Hint: "Suggested first on purchase requisitions and RFQs. Add new vendors in Procurement → Vendors." | Procurement (PR / RFQ suggestions), and the Vendors panel on the item page |
| Minimum order qty (<UOM>) | optional | Number >= 0; label shows the item's unit. Hint: "Smallest quantity the vendor sells. Planning rounds orders up to it." | Planning / MRP rounding |
| Part Code | optional | Vendor's or drawing part number. Placeholder "Part code". Saved as the item's part number. | Search (list search covers it); vendor catalog / PO line matching in the Vendors panel |
| Make / Brand | optional, hidden for Service | e.g. SKF | Display |
| Manufacturer | optional, hidden for Service | text | Display |

Errors: "The preferred vendor picked no longer exists — reload the page and pick it again." / "Vendor '<name>' is <status>, so it can't be the preferred vendor. Pick an active vendor, or ask Procurement to re-activate it." / "<Minimum order quantity> can't be negative — enter 0 or more, or leave it blank."

### 3.5 Tax & Accounts section

| Label | Required | Entry | Affects |
|---|---|---|---|
| HSN code (for Service the label becomes **SAC code**) | optional | Digits only, max 12 typed. Goods: 4, 6 or 8 digits. Services: exactly 6 digits starting with 99. Placeholder "4, 6 or 8 digits" or "6 digits, starts with 99". Hint: "From the vendor's tax invoice. Required on GST invoices and e-invoices." | GST invoices, e-invoice |
| GST rate | optional | Dropdown "— Not set —" plus the ACTIVE rates from Finance's GST rate master (shown like `18%`). Hint: "Rates come from Finance's GST rate master." | Default tax on PO / invoice lines |
| Purchase ledger | optional | Searchable; "— Use category / Finance default —". Lists active posting ledgers of the allowed types. Hint "Leave blank to use the category ledger. Assets go to a fixed-asset ledger." (on edit: "Now: <ledger> (<source>)."). Order of use: item, then category, then Finance's default. | Finance posting of purchases |
| Sales ledger | optional | Same logic. Hint "Only for items we also sell (spares, finished goods)." | Finance posting of sales |

Source texts on the item page: "set on this item", "from the item's category", "Finance's default ledger", "no ledger — Finance must set the default under Finance → Masters → Ledger Settings".
Errors: "HSN / SAC code '<c>' must contain digits only — e.g. 7318 for bolts, 998719 for repair services." / "'<c>' isn't a SAC code — services use a 6-digit SAC starting with 99 (e.g. 998719). Check the vendor's invoice or ask Finance." / "HSN code '<c>' has <n> digits — goods use 4, 6 or 8 digits (8 on e-invoices). Check the vendor's invoice." / "GST <r>% isn't an active rate in Finance's GST rate master. Pick one of: <list>." If Finance has not set up any: "...Pick one of: none — Finance hasn't set up GST rates yet."
Changing the item type later re-checks an existing HSN/SAC against the new type's rule.

### 3.6 Stock Levels & Cost section (hidden when type is Service)

| Label | Entry | Meaning |
|---|---|---|
| Standard cost (₹ per unit) | number >= 0, placeholder "Planned rate" | Planning rate for BOM estimates. "Stock is valued at the system weighted average, not this." |
| Reorder level (<UOM>) | number >= 0 | Hint: "Raise a PR when free stock falls to this." (really: projected stock, see 8) |
| Reorder qty (<UOM>) | number >= 0 | Quantity suggested when reordering |
| Safety stock (<UOM>) | number >= 0 | Buffer |
| Minimum stock (<UOM>) | number >= 0 | Used as the trigger when no reorder level is set |
| Maximum stock (<UOM>) | number >= 0 | Upper limit |

All optional. Rules checked together on save (exact messages):
- Any negative: "<Label> can't be negative — enter 0 or more, or leave it blank."
- Min > Max: "Minimum stock (<a>) is more than maximum stock (<b>) — the maximum must be the larger number."
- Reorder level > Max: "Reorder level (<a>) is above maximum stock (<b>) — you would reorder when the store is already full. Lower the reorder level."
- Safety > Reorder level: "Safety stock (<a>) is above the reorder level (<b>) — reorder must trigger before stock falls into the safety buffer. Raise the reorder level."
So keep: Safety <= Reorder level <= Maximum, and Minimum <= Maximum.

### 3.7 Quality & Tracking section (hidden when type is Service)

Five tick boxes (exact labels):
1. "Inspection on receipt — receipts go to Quality stock with an inspection lot instead of straight to Free stock". Affects GRN and production output: the quantity waits in Quality stock until Quality accepts it. Unticking also clears the certificate box.
2. "Test certificate (MTC) required — an incoming lot can't be accepted until the certificate is marked received". Greyed unless Inspection is ticked. Error if saved without inspection: "'Test certificate required' only works with 'Inspection on receipt' — the certificate is checked when Quality accepts the inspection lot. Tick both, or untick the certificate."
3. "Batch / heat number tracked". GRN then forces the storekeeper to enter the vendor's heat/batch number(s) for the received qty (system creates batch numbers BT-<year>-<nnnn>), with TC number. Issues pick from batches (FIFO by receipt date; FEFO when expiry is on). If the item is NOT batch tracked, GRN refuses batch numbers: "'<item>' isn't batch-tracked in the Item Master, so it can't take batch / heat numbers. Remove them, or tick 'Batch tracked' on the item first."
4. "Serial number tracked (one serial per unit)". One serial per unit must be named on GRN, issue, return, transfer; the Serial Nos. page shows the history.
5. "Has expiry (paint, adhesives, chemicals)". When ticked a small box "Shelf life (days)" appears. Error if blank: "Expiry-controlled items need a shelf life — enter the shelf life in days, or untick expiry control." Effect (batches.py): the GRN asks the expiry date per batch ("'<item>' is expiry-controlled — enter heat <h>'s expiry date (or its manufacturing date, with a shelf life set on the item)"), and issues are suggested earliest-expiry-first (FEFO). IMPORTANT: expiry dates are held on batch rows, and batches exist only for batch-tracked items, so tick BOTH "Batch / heat number tracked" and "Has expiry" for paint-like items (the form does not force this).

Behaviour to teach: Service items do not show Stock Levels or Quality & Tracking at all (a service has no stock).

---

## 4. Item detail page

Header: small caption "Store & Inventory · Item Master", big item code. Buttons right: **Edit** (items:edit), **Delete** (items:delete, red), **← Back**. Errors from save/delete appear in dialog "Cannot Save Item"; load failure dialog "Failed to Load Item" with "Back to Items".

Sections of the read-only view (one card):
1. Summary block: item name, line "<Type> · <Category> › <Subcategory> — stocked, bought and issued in <UOM>.", pills: status (Active / Inactive / Discontinued), "Code <code>", "Part code <x>". Photo box sits at the right of the summary (click to add, Change, Remove, no need to enter Edit; shows "No photo" for users without edit).
2. Item Details: Item Type, Category, UOM, Technical Specification.
3. Planning & Cost: Purchase lead time ("<n> calendar day(s)" or "Not set — MRP will assume one"), Legacy code (v3 / Tally), Standard cost (needs `items:edit` or Stock value feature), Weighted average (needs the "Stock value & rates" feature; text like "₹125.5 (system weighted average · last receipt ₹130 on <date>)" or "Not valued yet").
4. Purchasing: Preferred vendor (name (code); old free-text supplier shows "(not linked to the vendor master — pick it again)"), Minimum order qty, Make / Manufacturer.
5. Tax & Accounts: HSN or SAC code ("Not set — needed on GST invoices"), GST rate, Purchase ledger, Sales ledger (with source in brackets).
6. Stock Levels (not for Service): Reorder level / qty, Safety stock, Min / Max stock.
7. Quality & Tracking (not for Service): Inspection on receipt (Yes - GRN / production receipts go to Quality stock and get an inspection lot / No - receipts go straight to Free stock), Test certificate required, Batch / Serial tracked (Yes / No pair), Expiry (Yes — shelf life n day(s) / Yes — shelf life not set / No).
8. **Plant data (MRP views)** section (needs feature Plant data view; button **Edit plant data** needs feature Plant data edit). Table columns: Plant, MRP type, Make / buy, Reorder level, Safety stock, Min, Max, Reorder qty, Purchase days, Make days, Default store, Purch. blocked. Edit opens popup "Edit Plant Data" (Cancel / "Save plant data", "Add a plant…" dropdown + Add, per-row Remove). MRP type options: Reorder point (store reorder list raises the PR), MRP (planned by Production MRP), No planning. Make/buy: Buy, Make, Make or buy. A plant with no row uses the item's own company-wide fields. "Purch. blocked" stops purchasing that item for that plant ("'<item>' (<code>) is blocked for purchasing at plant <plant>. Clear 'Purchasing blocked' in Store › Item Master › Plant data, or buy it for another plant."). Rules: one row per plant ("Plant <p> is listed twice — keep one row per plant."), no negatives, max >= min, reorder level >= safety stock, default store must belong to that plant. Text on screen: "Planning per plant. Reorder runs per plant with that plant's stores' stock; a plant without a row uses the company-wide fields above. MRP type 'MRP' leaves the item to Production MRP." Empty: "No plant-specific data — every plant uses the Item Master fields."
9. **Vendors for this item** (needs feature "Who can supply this item"): table Vendor (Preferred pill), Last PO rate, Last PO (number + date), POs / Qty bought, Catalog price, Catalog lead time. Order: preferred first, then vendors we bought from (latest first), then vendors whose catalog lists it. Match is by item id on PO lines, else part code = item code / legacy code / part code / manufacturer part number, else exact item name. Empty message: "No vendor has supplied or listed this item yet. Pick a preferred vendor, or add it to a vendor's catalog in Procurement → Vendors."

NOT on the item page (checked): no stock-by-store table, no stock history/movements list, no batch/serial list. Stock by store is on Inventory > Stock; ledger on Movements; batches/serials on their own pages.

### Edit form
Click **Edit**: the page turns into "Edit <item name>" (subtitle "<code> · changes apply from now on; posted documents keep their values."), footer **Cancel** / **Save Changes**, header "← Back" (same as Cancel). Same sections as Add Item with differences:
- Item Code box read only, "Fixed once created."
- Extra field **Status** (right of UOM): Active / Inactive / Discontinued.
- Planning section is titled "Planning & Cost"; right column adds "Weighted Average" (read-only, needs Stock value feature, "Read-only — kept by priced receipts.") and Photo.
- Plant data and Vendors blocks are only on the read-only view.
- Saved text is trimmed; cleared fields are saved as empty.

What is locked / refused after use:
- Item Code: never editable.
- UOM: if the item already has any stock movement, changing it is refused (409): "'<name>' already has stock movements in <UOM>, so its unit can't be changed — create a new item for the new unit." Also "An item must keep a unit of measure — pick one from the UOM dropdown."
- Everything else can still be edited (including Item Type, with category and subcategory cleared); posted documents keep their old values.
- Invalid status: "Status '<x>' isn't valid — choose one of: active, inactive, discontinued."
- Same validation rules and messages as section 3.

Status meanings (as implemented):
- Active: normal.
- Inactive / Discontinued: purchase pickers (PR, PO line link, Product/BOM pickers for Design/Electrical/Hydraulic/Production, Quality) list only ACTIVE items, and BOM / work-order checks flag non-active components. Store's own pickers (Issue, Transfer, Return, Adjustment, Movements, Reservations, Stock) call the item list without a status filter, so inactive items are still offered there.
- Inactive vs Discontinued has no different system behaviour (both are "not active").

### Delete
**Delete** opens the confirm dialog "Delete this item?" — message: `This permanently removes "<name>" from the item master. This cannot be undone.` Items are never soft-deleted. Server refuses (409) if the item has: stock movements, material issue lines, return lines, transfer lines, adjustment lines or reservations. Message: "'<name>' can't be deleted — it has <n stock movement(s), n material issue line(s), ...>. Set its status to Inactive instead so it's no longer offered." If another module links it (BOM, work order, design document, spare-part list): "'<name>' can't be deleted — another module (BOM, work order, design document or spare-part list) still links to it. Remove it there first, or set the item to Inactive." Opening-balance rows with zero stock are removed with the item. Error is shown in the "Cannot Save Item" dialog (title is generic).

---

## 5. Import

Button **Import** on the list opens the popup "Import Items" (subtitle "Bulk-add items to the Item Master from a CSV or Excel file."). Sections: "File Format" (button **Download template**, file `item_master_import_template.csv`), "Upload" (click box "Click to choose a .csv or .xlsx file"). Footer: **Cancel** / **Import** ("Importing…"). If no file chosen: "Choose a .csv or .xlsx file first."

Template columns (15, header row 1; header names are case-insensitive): `item_type, category, subcategory, item_name, uom, technical_specification, lead_time_days, legacy_code, part_code, hsn_sac_code, gst_rate, preferred_vendor, standard_cost, min_order_qty, reorder_level`.
Required per row: `item_name` and `uom`. Everything else optional. The on-screen help text lists only the first 6 columns (incomplete; see section 8). Template sample rows: Material / Hardware & Fasteners / Hex Bolt M12x50 / NOS / "Zinc plated" / lead time 21 / HSN 7318 / GST 18 / std cost 12.50 / MOQ 100 / reorder 200, and Consumable / PPE / Safety Gloves / PAIR.
Also accepted header spellings from the Excel export: "lead time (days)", "legacy code", "part code", "hsn / sac", "gst %", "preferred vendor", "standard cost", "min order qty", "reorder level"; an old `description` column is read as technical specification.

Rules:
- File types: .csv (UTF-8) or .xlsx/.xlsm (first sheet). Anything else: "Upload a .csv or .xlsx file — download the template to start from the right columns." Bad UTF-8: "Could not read the file as UTF-8 text — save it as CSV (UTF-8) from Excel and try again." No rows: "The file has no data rows — fill in at least one item under the header row." More than 5000 rows: "The file has <n> rows — import at most 5000 at a time by splitting it." Missing columns: "Missing the item_name / uom columns — download the template and keep its header row."
- Item code in the file is ignored; codes are generated (next running number per saved row).
- item_type: blank = Material; accepts the code (`tool_equipment`) or the label ("Tool & Equipment" or "Tool and Equipment").
- category must be an existing top-level category OF THAT TYPE. A new subcategory name under a valid category is CREATED automatically (code auto-made). Subcategory without category is an error.
- uom must exist in the unit list; case does not matter (made upper case).
- gst_rate must be an active Finance rate; hsn_sac_code follows the same rules as the form (SAC for Service); preferred_vendor = vendor code or exact vendor name of an ACTIVE vendor; numbers must be >= 0 (commas, % and ₹ signs tolerated).
- Duplicate handling: a row whose item name AND technical specification both match an existing item (case-insensitive), or an earlier row in the same file, is NOT saved and is reported under "Already exist — not saved" (reason "Same name and technical specification already exist" or "Repeats row <n> of this file"). Same name with a different specification counts as a different item and is created.
- Legacy code duplicates (in the master or inside the file) are errors.
- Not imported at all: Make, Manufacturer, ledgers, safety/min/max stock, reorder qty, quality tick boxes, batch/serial/expiry, photo, status (all imported items are Active). Set those afterwards on each item.
- Saving is per row (good rows are saved even if others fail; it is NOT all-or-nothing, unlike the stock import).

Result screen: line "<n> new items saved · <n> already existed (not saved) · <n> with problems (not saved)", and up to three tables: "New items saved" (Row, Item Code, Name, Type, Category), "Already exist — not saved" (Row, Name in file, Existing Item, Why), "Problems — not saved" (Row, Name, Fix). Row numbers are Excel row numbers (header = row 1, first item = row 2). Buttons: **Import another file**, **Done**. Typical "Fix" texts: "Item name is empty — fill in item_name." / "UOM is empty — fill in a unit like NOS, KG or MTR." / "UOM '<x>' isn't in the unit list — add it from the UOM dropdown first, or use a listed unit." / "Item type '<x>' isn't valid — use one of: <labels>." / "Category '<x>' isn't a <Type> category — use one of: <list>." / "Subcategory given without a category — fill in the category too." / "Preferred vendor '<v>' is not an active vendor — use the vendor code from Procurement → Vendors." (or "matches several vendors"). Permission: `items:import`; export: `items:export`.

---

## 6. Settings pages

All Settings pages show the header "Store & Inventory · Settings", the gear nav pills, and a table with a row-count chip. Delete/Edit are text links at the right of each row. Every "Delete" opens a confirm dialog (title "Delete this <thing>?", text "This permanently removes "<name>". This cannot be undone.") and refusals come in a dialog "Cannot Delete <thing>". Who can change = the matching Role editor tab (view / create / edit / delete). Admins can do everything.

### 6.1 Item Types (tab `item_types`)
Purpose: master list of item types (Material, Service, Asset, Consumable, Tool & Equipment are the standard five; Material is the default). Seeded standard categories per type are in 6.3.
Button "+ Add Item Type"; row links Edit / Delete. Columns: Name, Code Prefix.
Popup fields: **Name** (required, max 100, "Spare Part") and **Code prefix (2 letters)** (optional, placeholder "SP (blank = auto)", exactly 2 letters/digits, upper-cased). Note on popup: "The prefix is a short 2-character tag for this type. Item codes are one running number for all items (01, 02 …) and do not use it."
Rules/messages: "Enter the item type name." / "Item type name is too long — keep it to 100 characters or fewer." / "Item type '<n>' already exists — pick it from the list or edit it instead." / "Code prefix '<p>' must be exactly 2 letters or digits (e.g. SP). Leave it blank to make one from the name." / "Code prefix '<p>' is already used by another item type — enter a different prefix."
Editing renames the label; the internal value never changes, so items keep pointing at it.
Delete refused when: it is Material ("'Material' is the default item type (used when an item or import row has no type) and can't be deleted — rename it instead."), when items or categories use it ("Item type '<x>' can't be deleted — it's used by <n> item(s), <n> categor(ies). Move those to another type first, or rename this one."), or it is the last type.
Note: the prefix has no effect on item codes any more; it is only a tag.

### 6.2 Units of Measure (tab `uoms`)
Button "+ Add Unit". Columns: Code, Name. Popup "Add Unit of Measure"/"Edit Unit of Measure": **Unit code** (required, max 20, upper-cased, placeholder KG) and **Unit name** (optional, max 100, placeholder Kilogram). Notes: add = "Units are shared by Store items and Purchase Request lines."; edit = "Renaming the code also moves every item on this unit to the new code." (this note is WRONG, see below).
Seeded list: NOS Numbers, PCS Pieces, SET, PAIR, KIT, LOT, KG Kilogram, GM Gram, TON Tonne, MTR Metre, MM, CM, FT Foot, INCH, SQM, SQFT, CUM, LTR Litre, ML, BOX, PKT Packet, ROLL, BAG, DRUM, CAN, BTL Bottle, SHEET, COIL, BUNDLE, HR Hour, DAY, JOB.
Messages: "Enter the unit code (e.g. NOS, KG, MTR)." / "Unit code '<c>' is too long — keep it to 20 characters or fewer." / "Unit '<c>' already exists — pick it from the list or edit it instead." (409). Editing a code already used on an item, PR line, PO line or GRN line is refused: "Unit '<c>' is already used on <n store item(s), n PR line(s) ...>, so its code can't change — only its name can be edited. Create a new unit instead if you need a different code." Delete refused: "Unit '<c>' can't be deleted — it's already used on <...>. Edit its name instead, or change those records to another unit first." and last-unit rule.
Reading the units list is open to every signed-in user (PR forms use it). The item form's UOM box is pick-only; add units here.

### 6.3 Categories (tab `categories`)
Purpose: two-level grouping (category, then subcategory) per item type; also decides the default Finance ledgers for items.
Button "+ Add Category". Table columns: Name (subcategories indented with "↳"), Code, Item Type ("All types" if none), Parent, Purchase Ledger ("Finance default", or "Same as parent" for subcategories), Status (Active/Inactive), Edit / Delete.
Add popup "Add Category" (subtitle "Group items for reports, codes and Finance ledgers."): sections
- Basic Information: **Name** (required; placeholder "Raw Materials"), **Code** (optional on add: exactly 3 letters/digits, auto-upper-cased, placeholder "ELE", blank = made from the name; fixed after creation), **Parent Category** (dropdown "— Top-level category —" plus existing top-level categories; picking one makes this a subcategory; fixed after creation).
- Item Type (only for top-level): dropdown of types; default Material. Subcategories follow their parent's type automatically.
- Finance Ledgers (optional, only top-level): Purchase ledger (default "Finance default (Purchases)") and Sales ledger ("Finance default (Sales)"). Hint: "Every item in this category books to these ledgers unless the item sets its own. Agree them with Finance."
- Status (edit only): "Active" tick box. Inactive categories are only a label; the item form still lists them (see section 8).
Rules/messages: "Name is required." (form) / "Enter the category name." / "'<n>' already exists as a top-level category — pick it from the list or edit it instead." or "...already exists under '<parent>' — ..." (409) / "Category code '<c>' must be exactly 3 letters or digits (e.g. ELE). Leave it blank to make one from the name." / "Category code '<c>' already exists — use a different code." / "Ledgers are set on the top-level category, not on a subcategory — set it on '<parent>'." / "Parent category not found — reload the page and pick it again." On rename "'<n>' already exists here — choose a different name." Renaming a category/subcategory also renames it on every item that uses it.
Delete refused: "Cannot delete — this category has subcategories under it." or "'<name>' can't be deleted — <n> item(s) are in it. Move them to another category first, or untick Active so it's no longer offered."
Seeded standard categories (name, code): Material: Raw Material RAW, Production Material PRD, Electrical ELE, Hydraulic & Pneumatic HYD, Mechanical Components MEC, Hardware & Fasteners HWF, Paint & Chemicals PNT, Packaging PKG. Service: Job Work JOB, Maintenance Service MSV, Professional Service PSV, Consultancy CON, Other Service OSV. Asset: Machinery MCH, Equipment EQP, Vehicle VEH, IT Asset ITA, Furniture FUR. Consumable: Office Consumables OFC, Cleaning CLN, PPE PPE, Workshop Consumables WSC, Production Consumables PRC. Tool & Equipment: Hand Tools HTL, Power Tools PTL, Measuring Instruments MIN, Testing Equipment TEQ, Engineering Tools ENG. (From the seed list in the model; the live database may differ if an admin changed it.)
Dependency summary: Type picks the Category list; Category picks the Subcategory list; changing a parent resets the child fields.

### 6.4 Stores (tab `warehouses`, label "Stores (locations)")
Purpose: the physical stores; every stock document is posted against a store; each store belongs to a plant (branch). A store's plant decides who sees its stock (Store data scope).
Button "+ Add Store". Columns: Name, Code, Branch, Type, Status (Active/Inactive), and a red **Delete** link (needs `warehouses:delete`). There is NO Edit link on this page (see section 8).
Popup "Add Store" (subtitle "Group items for ..." not used; uses form sheet): Basic Information: **Name** (required, placeholder "Main Store — Plant 1"), **Code** (required, placeholder "WH-01", unique, up to 30), **Branch** (dropdown "— Select —" of company branches/plants), **Store Type** (free text e.g. "Raw Material, Finished Goods…"); **Address** (optional text). Errors: "Name is required." / "Code is required." / "Location code '<c>' already exists" (409).
Plant rules: a non-admin cannot set a manager and may only create stores in their own plant: "You can only create stores in your own plant — pick your plant in the Plant field, or ask an admin to create a store for another plant (Store → Settings → Stores)." Only admins may move a store to another plant or change its manager. (The API also has manager, storage type, inventory type, operating hours and status fields, but the screen offers none of them.)
Delete refused when the store has stock movements, issues, returns, adjustments, transfers, reservations, GRNs, PR lines, maintenance spares, production work orders or hydraulic service parts: "Cannot delete '<name>' — it has <list> recorded against it. Edit the store and set its status to Inactive instead, so its history stays intact." (no screen to do that). Unused store: also removes its empty balances and its bins, and clears it as default store of branches/companies/items.
The list is limited to the user's plant(s) by data scope.

### 6.5 Issue Types (tab `issue_types`)
Purpose: "Why material was issued (Production, Maintenance, Project…). Picked on every Material Issue, used for consumption reports."
Table columns: Name, Status, Edit/Delete links. Fixed standard list in code (11): Production, Maintenance, Project / Site, General / Office, Rework, Testing, Job Work / Subcontracting, Scrap / Disposal, Customer Sample / Trial, Dispatch to customer, Service / Spares to site. What each type asks for on the Issue form (required fields, challan, vendor, return date) is fixed in code (issue_forms.py), not configurable.
The page still shows "+ Add issue type" (label "Add Issue type") and Delete links, but the server refuses: "Issue types are fixed in code and can't be added, switched off or changed here — only renamed. Extra mandatory fields per type (vendor, return date, challan) are set in Store › Settings › Issue Rules." (that last sentence is outdated: Issue Rules was retired). Rename (Edit > Name) works only for admins; non-admins get the same refusal. Edit popup also has Status "Active" tick box, but changing it is refused for issue types. Delete is always refused for issue types ("fixed in code").
Name rules: "Enter the issue type name." / over 100 chars / "A issue type named '<x>' already exists — edit that one instead."

### 6.6 Issue Rules and Entry Types
Both URLs redirect to Store Settings. Issue Rules were retired 2026-10-12 (fixed standard per issue type). Entry Types: Record Stock Entry was removed; the old three types (Receipt, Issue, Damage / write-off) only keep old entries' labels. The server returns 410 for any attempt to add/change them. Do not document them as screens.

---

## 7. Worked example: six demo items

Common: Item Code is automatic (shown here as the next numbers 01-06 on an empty master; your real codes will follow the current running number). Leave Planning/Legacy code empty unless known. Purchasing and Tax values below are examples; use the real vendor and Finance GST rates.

| Field | 1. Raw material (batch + inspection) | 2. Bought-out part (serial) | 3. Consumable (reorder levels) | 4. Expiry item (paint) | 5. Tool | 6. Service |
|---|---|---|---|---|---|---|
| Item Type | Material | Material | Consumable | Material | Tool & Equipment | Service |
| Category | Raw Material | Hydraulic & Pneumatic | PPE | Paint & Chemicals | Measuring Instruments | Job Work |
| Subcategory | (none) | (none) | (none) | (none) | (none) | (none) |
| Item Name | MS Plate 20mm IS 2062 E250 | Hydraulic Pump 63 cc/rev Gear Type | Safety Gloves Cotton Palm Coated | Epoxy Primer Red Oxide 20 L | Digital Vernier Caliper 0-150 mm | Machining Job Work (Turning) |
| UOM | KG | NOS | PAIR | LTR | NOS | JOB |
| Technical Specification | IS 2062 E250 BR, 20 mm thick, 2500 x 1250 sheet, mill TC with each heat | Fixed displacement, 63 cc, SAE B 2 bolt flange, shaft 1 in keyed | Size 9, cotton knit with PU palm coat, EN 388 | 2 pack epoxy, 20 L can, mix 4:1, pot life 4 h | 0-150 mm, 0.01 mm resolution, IP54, with case | Turning on customer-supplied rod, tolerance as per drawing |
| Part Code | (blank) | PMP-63-SAEB (vendor part no.) | (blank) | (blank) | (blank) | (blank) |
| Preferred vendor | pick the steel supplier | pick the hydraulics supplier | pick the PPE supplier | pick the paint supplier | (blank) | pick the job-work vendor |
| Min order qty | 500 | 1 | 50 | 20 | 1 | (blank) |
| Make / Manufacturer | (blank) | e.g. Rexroth | e.g. Karam | e.g. Asian Paints | Mitutoyo | (hidden for Service) |
| HSN / SAC | 7208 | 8413 | 6116 | 3208 | 9017 | 998898 (SAC, 6 digits starting 99; confirm with Finance) |
| GST rate | 18% | 18% | 12% | 18% | 18% | 18% |
| Purchase ledger | blank (category / Finance default) | blank | blank | blank | blank or fixed-asset ledger if capitalised | blank |
| Standard cost | 62 | 18500 | 45 | 3800 | 2800 | (hidden) |
| Reorder level | 2000 | 2 | 100 | 40 | (blank) | (hidden) |
| Reorder qty | 5000 | 2 | 200 | 80 | (blank) | (hidden) |
| Safety stock | 1000 | 1 | 50 | 20 | (blank) | (hidden) |
| Min / Max stock | 1000 / 10000 | 1 / 6 | 50 / 400 | 20 / 160 | (blank) | (hidden) |
| Inspection on receipt | tick | tick (functional test) | no | no | tick (calibration check) | (hidden) |
| Test certificate (MTC) required | tick | no | no | no | no | (hidden) |
| Batch / heat number tracked | tick | no | no | tick | no | (hidden) |
| Serial number tracked | no | tick | no | no | no (use asset/tool register elsewhere) | (hidden) |
| Has expiry / shelf life | no | no | no | tick, 365 days | no | (hidden) |
| Photo | optional | optional | optional | optional | optional | none |

Notes for the teacher:
- Check the numbers obey: Safety <= Reorder level <= Maximum, Min <= Maximum (all six pass).
- Item 4 needs both Batch and Expiry ticked (see 3.7); the GRN then asks for the expiry date per batch.
- Item 6 shows the SAC label and hides stock and quality sections.
- HSN/SAC and GST values are illustrative only; confirm with Finance before saving real items.

---

## 8. Open questions and places where screen and tour text disagree

Tour (stale) versus screen:
1. `storeItemForm.ts` has a step "Item Code - required, validExample 'RM-0001', cannot be changed" and says Save needs "Item Code and Item Name". Wrong: the code is automatic, read only; required fields are Item Name and UOM.
2. Add Item page subtitle still reads "the code is assigned on save from type + category" (frontend/src/app/dashboard/store/new/page.tsx). The code is a plain running number. Screen text bug.
3. `storeItemTypes.ts` says item types "give item codes their prefix", prefix "Up to 6 letters", example "SP -> SP-0001". Wrong: prefix is exactly 2 characters and is NOT used in item codes (popup note says so).
4. `storeItemsList.ts` mentions nav targets `store-nav-box` and `store-nav-pm-work` ("Project Work") that do not exist in StoreNav; Settings description lists "Issue Rules and Plant Access" which no longer exist; Search described as "item code or item name" (it also searches legacy code, part code, spec, category); Export said to be "Excel" correct; the Inventory pill list omits Batches, Bins, Serial Nos.
5. `storeCategories.ts`: says Code is required and example "RM"; actually optional on add, exactly 3 letters/digits (e.g. ELE), blank = auto. Missing steps for Item Type and Finance Ledgers.
6. `storeWarehouses.ts`: says the store is "immediately available on GRN, Stock Entry, Issues and Transfers" (Stock Entry was removed); no mention of the missing Edit action.
7. `storeIssueTypes.ts`: "+ Add Issue Type" and "Use Issue Rules to decide..." are outdated: issue types are fixed (add refused) and Issue Rules is retired.
8. `storeUoms.ts`: ok except "Prefer standard GST UQC codes" and "Renaming a code later also moves every item on it" (see 9 below).
9. Units page edit note says "Renaming the code also moves every item on this unit to the new code." but the server refuses a code change once the unit is used on any item/PR/PO/GRN line (only the name can change).
10. `storeItemDetail.ts` / `storeItemEditForm.ts`: Edit tour says "Item Code stays fixed" (true); they do not cover Plant data or the Planning & Cost block. Edit tour says UOM is "required... Change it only if no stock exists yet" (accurate in spirit; actually server-enforced).
11. Hint text on the form: Reorder level "Raise a PR when free stock falls to this." Actual reorder logic (services/reorder.py) compares PROJECTED stock (free minus reserved, plus quantity already on open PRs/POs) with the reorder level, or with minimum stock when no reorder level is set.

Behaviour questions / oddities to confirm with the owner:
A. Item list sorts the text code, so 100 appears before 11 (backend `order_by(item_code asc)`, frontend does not re-sort). Rule 14 says tables load ascending by code; once codes pass 99 the visual order is wrong. Suggest numeric sort.
B. Stores page has no Edit (backend supports PATCH incl. status Inactive; the delete error tells users to "Edit the store and set its status to Inactive", which they cannot do from the screen). Manager, storage type, operating hours also unreachable.
C. Issue Types page shows Add/Delete controls that the server always refuses; only admins can rename. The refusal text points to the retired Issue Rules.
D. Role editor still lists "Stock Entry Types" and "Issue Rules" tabs (phantom permissions, against rule 17).
E. Inactive categories still appear in the item form's Category list (CategorySelect does not filter `is_active`). Text on delete says "untick Active so it's no longer offered", which is not true on the item form.
F. Expiry without Batch: the form lets you tick "Has expiry" without "Batch tracked", but expiry dates are only captured on batch rows. Suggest the form force or warn.
G. Item list has no Status filter and no count chips; Inactive items remain visible and pickable in Store issue/transfer/return/adjustment forms but not in Purchasing pickers.
H. Delete confirmation says "permanently removes"; error dialog title for a failed delete is "Cannot Save Item".
I. Import help text lists 6 columns but the template and server accept 15; subcategory typed in the file is created automatically if missing (a typo creates a new subcategory).
J. Item page shows no stock by store and no history; the brief expected them. They live on Stock, Movements, Batches, Serial Nos. pages (other notes).
K. Components StockEntryDialog (used from Movements), StockImportDialog (opening-stock import on the Stock page, all-or-nothing) and StockAsOfPanel ("Stock on a date" on the Stock page, features `stock:as_of`) are not part of Item Master or Settings; they belong to the Stock/Movements notes.
L. Photo upload depends on SharePoint config on the server; if not configured users see the 503 text in 3.1.
