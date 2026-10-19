# CRM Module

The CRM (Customer Relationship Management) module is where the Business Development (BD) team records every customer organization, its contact persons, and every business opportunity that comes from it. An opportunity is either an **Inquiry** (a direct customer requirement) or a **Tender** (a published bid). CRM is the first step of the company's core business flow: Customer → **BD** → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance. From CRM the BD team sends the Technical Requirement to R&D, receives R&D's Technical Offer back, prepares and revises Quotations, logs follow-ups and meeting minutes, and finally hands the order over to Sales by creating a Sales Order. When that Sales Order is confirmed in Sales, the inquiry or tender is automatically closed as ordered. Organizations created in CRM are also used by Accounts as the customer master.

## 1. Navigation Tabs

The CRM sub-nav (CrmNav) sits at the top of every CRM page. A tab is only shown if the user has View permission on it (Permission Matrix key crm:[tab]:view). On the right of the nav there is a guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/crm | CRM Dashboard: counters, pinned records, recently viewed records and recent follow-ups. |
| Customer Organizations | /dashboard/crm/organizations | List of all customer organizations, with add, export, import and duplicate review. |
| Inquiries & Tenders | /dashboard/crm/inquiries | One combined list of inquiries and tenders, with New Record, export and import. |
| Settings | /dashboard/crm/settings | CRM lists (Products, Product Categories, Payment Terms, Document Categories) and notification rules. |

Pages that are not tabs but belong to CRM:

- Follow-ups (/dashboard/crm/followups) is opened from the dashboard counters and from follow-up notifications in the bell.
- Technical Offer Request viewer (/dashboard/crm/technical-offer/[ref]) is a stand-alone document viewer.
- Old addresses that now redirect: /dashboard/crm/bulk-import goes to Customer Organizations; /dashboard/crm/products, /dashboard/crm/product-categories and /dashboard/crm/payment-terms go to Settings with that list open; /dashboard/crm/tenders goes to Inquiries & Tenders filtered to tenders; /dashboard/crm/tenders/new goes to New Record with the Tender tab selected.

## 2. Dashboard

Route: /dashboard/crm. Needs CRM app access and View on CRM › Dashboard. Heading "CRM Dashboard" with the line "Welcome back, [user name]. Here is the state of your business development pipeline." All numbers and lists come from the backend endpoint /crm/dashboard and are limited to the user's CRM data scope (only records the user is allowed to see). Deleted records are never counted. If loading fails, a red box shows the real error with a **Reload** button.

### Counter cards (top row)

Seven cards. Each card is a link.

| Card | What it shows | How it is computed | Click opens |
|---|---|---|---|
| Organizations | Total organizations | Count of non-deleted organizations in scope | Customer Organizations list |
| Inquiries | Total inquiries | Count of non-deleted inquiries in scope | Inquiries & Tenders list |
| Tenders | Total tenders | Count of non-deleted tenders in scope | Inquiries & Tenders list filtered to Tender |
| Open Follow-ups | Follow-ups still open | Follow-ups with status Open | Follow-ups page, Open bucket |
| Overdue Follow-ups | Late follow-ups | Status Open and Next Follow-up Date before today | Follow-ups page, Overdue bucket |
| Today's Follow-ups | Follow-ups due today | Status Open and Next Follow-up Date equal to today | Follow-ups page, Today bucket |
| Pending Tenders | Tenders still running | Tenders whose status is not "Closed – Ordered", "Closed – Not Ordered" or "Tender Cancelled" | Inquiries & Tenders list filtered to Tender |

**Actions:** click any card to open the linked page.

### Pinned Inquiries & Tenders

Shows up to 12 inquiries or tenders the user pinned with the pin icon on the Inquiries & Tenders list. Pins are stored only in this browser (not shared with other users or devices). Each pinned card shows the record ID (for example INQ-20260917-0004), a coloured INQUIRY or TENDER label, the title (inquiry product or category, or the tender name) and the current status as a coloured badge. The record is loaded fresh each time, so the status is live; a pin whose record was deleted is dropped silently. If nothing is pinned the panel says "Nothing pinned yet. Click the ☆ next to an inquiry or tender on the Inquiries & Tenders list to keep it here."

**Actions:**
- Click a card to open that inquiry or tender.
- Click the star icon on a card to unpin it.
- **View all →** opens the Inquiries & Tenders list.

### Recently Viewed Organizations / Inquiries / Tenders

Three panels side by side. Each shows the last 5 records of that kind the user opened in this browser (stored per user in the browser; up to 8 kept per kind), newest first, with a sub-line (city or type for organizations; organization and product for inquiries; organization and tender name for tenders) and how long ago it was opened ("just now", "5 min ago", "2 h ago", "yesterday", "3 days ago"). If the user has not opened any yet, the panel says "You haven't opened any yet — showing the newest." and lists the 5 newest records from the server instead (organization name and city or type; inquiry or tender ID and status).

**Actions:**
- Click a row to open that record.
- Click × on a row to remove it from the recently viewed list.
- **View all →** opens the matching list.

### Recent Follow Ups

The 5 most recently created follow-ups in scope. Each row shows the activity type (or "Follow Up"), the remarks as plain text and the follow-up status.

**Actions:** click a row to open the inquiry or tender it belongs to (rows logged against an organization only are not clickable).

## 3. Screens

### Follow-ups — /dashboard/crm/followups

Opened from the dashboard counters (and from follow-up notifications). Title "Follow-ups" with "[n] records found".

#### List view

Three bucket buttons at the top: **Open Follow-ups** (status Open), **Overdue Follow-ups** (Open and due date before today), **Today's Follow-ups** (Open and due today). The bucket is part of the address (?bucket=open, overdue or today). Rows are sorted by due date, earliest first.

| Column | What it shows |
|---|---|
| Type | Activity type (Call, Email, Meet at Client/Site Office, Meet at Own Office) or "Follow Up" |
| Related | The inquiry or tender ID the follow-up belongs to |
| Organization | Organization name |
| Due Date | Next Follow-up Date, or "To Be Decided" when blank |
| Assigned To | Name in the follow-up's Assigned To field |
| Remarks | Remarks as plain text (cut off with a tooltip for the full text) |
| Status | Open (green) or other status (grey) |

**Row action:** clicking a row whose Related value is an inquiry or tender opens that record. **Top button:** ← Back returns to the CRM Dashboard.

### Customer Organizations — /dashboard/crm/organizations

#### List view

Header "Customer Organizations" with "[n] Organizations Found".

| Column | What it shows |
|---|---|
| Name | Pin icon, organization name (orange) and the organization code below it (ORG-YYYY-NNNN) |
| Type | Organization type |
| Railway Zone | Railway zone |
| City | City |
| Created Date | Date the organization was added |
| Created By | User who added it |

Search, filters and sort:
- Search box "Search name, type, zone, city, state..." searches on the server (runs 0.3 seconds after typing stops).
- Type, Railway Zone, City and Created By column headers are drop-down filters. Their options are the distinct values in the loaded list.
- Name sorts A–Z or Z–A; Created Date sorts Old or New. Default is Created Date, newest first.
- **Clear** resets the search and all column filters.
- Pinned organizations (pin icon on a row, stored in this browser only) always stay at the top of the list, in the same sort order.

Row action: click a row to open the organization's view page.

Top buttons:

| Button | Shown when | What it does |
|---|---|---|
| + Add Organization | User has Create on CRM › Organizations | Opens the Add Organization form |
| Export | User has Export on CRM › Organizations | Opens the export dialog: choose all, a selection, or a created-date range; downloads organizations.xlsx with Org Code, Organization, Type, Parent, Railway Zone, Division / Workshop, Address, City, State, PIN, Country, GST No., Phone, Email, Website, Contacts, Primary Contact, Primary Contact Mobile, Credit Limit, Credit Days, Created On, Created By |
| Import | User is an admin AND has Import on CRM › Organizations | Opens the CSV import dialog (see below) |
| ⚠ [n] duplicate organization names found — review | Admin only, and only when duplicates exist | Opens the Duplicate Organizations dialog |

Duplicate Organizations dialog (admin only): groups organizations that share the same name. Each line shows the internal number, code, city, state, GST number, and how many inquiries and tenders it has. Nothing is changed automatically; clicking a line opens that organization so the admin can merge or delete by hand.

Import from CSV dialog (shared by the Organizations and Inquiries & Tenders lists): one CSV covers organizations, contacts, inquiries and follow-ups together.
- **Download CSV Template** downloads crm_bulk_import_template.csv.
- Columns: organization (org_name, org_type, parent_org, railway_zone, division_workshop, address, country, state, city, pin_code, gst_number, official_phone, official_email, website), contact (contact_name, contact_designation, contact_mobile, contact_email, contact_department), inquiry (inquiry_ref, lead_source, product, product_category, product_spec, quantity, required_delivery_date, delivery_location, requirement_desc, priority, budget, expected_value, expected_order_date, bd_owner, sales_engineer, inquiry_division), follow-up (followup_activity_type, followup_subject, followup_activity_date, followup_next_followup, followup_assigned_to, followup_status, followup_remarks, followup_action_plan).
- Rules shown in the dialog: repeat the same org_name to add more contacts or inquiries under one organization (created once); a new contact_mobile under an organization adds a contact, a repeated one reuses it; give each inquiry an inquiry_ref so later rows with the same ref add products or follow-ups to it; only org_name is required; re-uploading is safe because existing records are updated, not duplicated. One follow-up is created for every row that has follow-up data.
- After **Import**, the dialog shows rows in file, organizations new/updated, contacts new/updated, inquiries new/updated, product lines added, follow-ups created, rows skipped, and a table of Row and Reason skipped.
- The file must be UTF-8 CSV with a header row. Import is admin-only on the server too. No emails are sent on import.

#### Create form — Add Organization (/dashboard/crm/organizations/new)

Breadcrumb "Customer Organizations › New", title "Add Organization", **← Back** top-right. One section "Organization Details". Buttons at the bottom: **Cancel** and **Save Organization**. After a successful save a "Organization Saved" message appears; closing it opens the new organization's view page.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Organization Name | text | Yes | Free text | Must not match an existing organization's name (case-insensitive) — server returns "An organization with this name already exists" |
| Organization Type | dropdown | Yes | Public Sector Undertaking (PSU), Govt Department, Railway, Private, Joint Venture, Other | Choosing Other shows a "Specify organization type" box, which is then required |
| Parent Organization | text | No | Free text | — |
| Railway Zone | dropdown | No | Northern, Southern, Eastern, Western, Central, South Eastern, North Eastern, Northeast Frontier, South Central, East Central, East Coast, West Central, North Central, North Western, South Western Railway, Metro Railway Kolkata, Not Applicable, Other | Shown only when Type is Railway or Govt Department. Other shows a "Specify railway zone" box. Changing Type to anything else clears zone and division |
| Division / Workshop | text | No | Free text | Shown only with Railway Zone |
| Address | multi-line text | No | — | — |
| Country | dropdown | No | India (default), USA, UK, UAE, Other | Other shows a "Specify country" box |
| State / UT | text | No | — | — |
| City | text | No | — | — |
| PIN Code | text | No | — | Max 6 characters |
| Official Phone | phone | No | — | Must be a valid phone number. **+ Add phone** adds extra phone rows (each removable) |
| Official Email | email | No | — | Must be a valid email; must not be used by another organization. **+ Add email** adds extra email rows |
| GST Number | text (auto upper-case) | No | — | Max 15 characters; must be a valid 15-character GSTIN; must be unique across organizations |
| Website | text | No | — | Must be a valid website address |
| Contact Persons | repeating block | No | — | See below |

Contact Persons block: one empty contact card is shown; **+ Add Contact** adds more; **Remove** appears when there is more than one card.

| Field | Type | Required | Rules |
|---|---|---|---|
| Name | text | Yes, if the card is used | A card with an empty name is ignored on save |
| Designation | text | No | — |
| Department | text | No | — |
| Mobile | phone | No | **+ Add phone** for extra numbers; each must be valid |
| Email | email | No | Must be valid; **+ Add email** for extra emails |

Duplicate check: every phone and email on the form (organization's own and every contact's) is compared live. A repeated number or email is highlighted amber with "Duplicate phone number." or "Duplicate email address." and the form cannot be saved until it is removed. The organization code (ORG-[year]-[4-digit number], restarting each year) is generated by the server on save.

#### View page — Organization detail (/dashboard/crm/organizations/[ref])

Header: organization type and code above the organization name. Buttons top-right: **← Back** (to the list), **Edit** (only when the user is the organization's creator or an admin AND has Edit on CRM › Organizations), **Delete** (only when the user has Delete on CRM › Organizations and either created the organization or is an admin). Opening this page adds it to the user's Recently Viewed list. Tabs (pill bar, with counts on Contacts, Inquiries and Tenders): Overview, Contacts, Inquiries, Tenders, Audit Trail. The address can carry ?tab=[name] to open a given tab.

Overview tab — three cards. Empty values show "Not provided".

| Card | Field | Meaning |
|---|---|---|
| Organization Details | Organization Code | Auto code ORG-YYYY-NNNN |
| Organization Details | Type | Organization type |
| Organization Details | Parent Organization | Parent body, if any |
| Organization Details | Railway Zone, Division / Workshop | Shown for Railway / Govt Department types, or if old data has a value |
| Location | Address, City, State, PIN Code, Country | Postal location |
| Contact & Registration | GST Number | GSTIN |
| Contact & Registration | Official Phone | Main phone plus extra phones, comma separated |
| Contact & Registration | Official Email | Main email plus extra emails |
| Contact & Registration | Website | Website |

Contacts tab:
- Each contact card shows initials, name, designation and department badges, mobile and email. Under the card, links to every inquiry and tender where this contact is the contact person ("Inquiry INQ-…", "Tender TND-…"); clicking opens the record, and its Back button returns here.
- **+ Add Contact** (only for users allowed to edit the organization) opens an inline form: Name (required), Designation, Department, Mobile, Email, then **Save Contact**. **Edit** on a card fills the same form (**Save Changes**).
- Rules: email must be valid. A mobile or email already used by another contact on the same organization is a hard stop (field turns amber, Save is disabled, message "Already used by another contact on this organization."). A same-name contact asks "Possible duplicate contact … Save anyway?".

Inquiries tab: table of the organization's inquiries — ID, Product, Contact Person, Status, Priority, Follow-up (next follow-up date). Clicking a row opens the inquiry. **+ Add Inquiry** (shown when the user is the organization's creator or an admin AND has Create on Inquiries & Tenders) opens the full inquiry form inline with the organization locked.

Tenders tab: table — ID, Tender No., Name, Status, Submission (date). Clicking a row opens the tender. **+ Add Tender** works like Add Inquiry, opening the tender form with the organization locked.

Audit Trail tab: list of history entries for the organization (who, when, summary), for example created and deleted events.

Delete: confirmation "Delete organization [name]? Its inquiries and tenders will also be deleted. This action cannot be undone." Deleting is a soft delete: the organization, all its inquiries and tenders, and all follow-ups and documents under them are moved to the recycle bin.

#### Edit — Edit Organization (/dashboard/crm/organizations/[ref]/edit)

Same form as Add Organization, title "Edit Organization", breadcrumb "[name] › Edit", button **Save Changes**. All fields are editable; there is no status lock. Existing contacts are loaded into the Contact Persons block and can be edited or removed. On save the organization is updated, removed contacts are deleted, edited contacts are updated and new ones created. Only the creator or an admin can edit (server rule). GST number and official email must still be unique. A contact that is still used on an inquiry, tender or follow-up cannot be removed: the organization and other changes are saved, the contact is put back, and a message "Saved — Some Contacts Not Removed" explains which contact was kept and why.

#### Statuses & workflow

Organizations have no status. Life cycle: created (code generated) → edited → soft-deleted (with everything under it). Creating an organization fires the "Organization created" notification rule from CRM Settings, if switched on.

### Inquiries & Tenders — /dashboard/crm/inquiries

#### List view

Header "Inquiries & Tenders". Inquiries and tenders are shown in one table.

| Column | What it shows |
|---|---|
| ID | Pin icon and the record ID, split over two lines (INQ-YYYYMMDD- / serial, or TND-YYYYMMDD- / serial) |
| Organization | Organization name |
| Product | Inquiry: product. Tender: tender category |
| Stage | Current stage (inquiry stage or tender stage) |
| Created Date | Date created |
| Created By | User who created it |

Search, filters and sort:
- Search box "Search ID, organization, product, owner, zone, stage..." searches inquiries and tenders on the server.
- Radio buttons **Inquiry** / **Tender** show only that kind. Arriving with ?type=tender or ?type=inquiry pre-selects it.
- Stage and Created By column headers are drop-down filters.
- Created Date sorts Old or Latest (default newest first).
- **Clear** resets search, type and column filters.
- Pinned rows stay at the top. Pins are stored in this browser and also feed the dashboard's Pinned panel.

Row action: click a row to open the inquiry or tender view page (inside the list address, ?id=[ref]&type=inquiry or tender).

Top buttons:

| Button | Shown when | What it does |
|---|---|---|
| + New Record | Create on CRM › Inquiries & Tenders | Opens New Record |
| Export | Export on CRM › Inquiries & Tenders | Export dialog (all, selection, or created-date range; follows the current search and type). Downloads inquiries_tenders.xlsx with an Inquiries sheet (Inquiry ID, Organization, Product, Category, Quantity, Required Delivery, Delivery Location, Specification, Requirement Summary, Status, Stage, Priority, Lead Source, BD Owner, Sales Engineer, Expected Value, Probability %, Expected Order Date, Next Follow-up, Technical Offer No., Sent to R&D On, Created On, Created By) and a Tenders sheet (Tender ID, Organization, Tender Name, Tender No., Authority, Portal, Type, Category, Tender Value, Currency, Status, Stage, Priority, BD Owner, Railway Zone, Division, Publish Date, Pre-bid Meeting, Submission Date, Opening Date, Participate, Awarded To, Contract Value, Technical Offer No., Created On, Created By) |
| Import | Admin AND Import on CRM › Organizations | Same CSV import dialog as on the Organizations list |

#### Create form — New Record (/dashboard/crm/inquiries/new)

Breadcrumb "Inquiries & Tenders › New", title "New Record", **← Back** top-right. Two toggle buttons choose the record kind: **Inquiry** or **Tender** (?type=tender pre-selects Tender). After saving, the new record's view page opens.

Inquiry form (button **Create Inquiry**). Three sections: Basic Information, Company Information, Product Requirement.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Inquiry Number | read-only | — | Preview INQ-YYYYMMDD-NNNN | The real number is assigned by the server on save (sequence per day) |
| Inquiry Date | read-only | — | Today | — |
| Lead Source | dropdown | Yes | Website, Google Ads, Facebook / Instagram, WhatsApp, Referral, Phone Call, Email, Walk-in, LinkedIn, Exhibition/Event, Justdial, Other | — |
| Customer Requirement Priority | dropdown | Yes | High — Important requirement, quick action needed; Medium — Normal requirement (default); Low — Can be handled later | Old records with a retired value keep it selectable |
| Status | dropdown | Yes | Requirement Received (default), R&D / Technical Review, Qualified, Quotation Sent, Order Received, Under Production, Closed - Ordered, Closed - Not Ordered | Server rejects any other value |
| BD Owner | searchable dropdown (admin) / read-only (others) | No | Admin: any user from the user directory. Others: fixed to the logged-in user's name | — |
| Current Status | multi-line text | No | Free note, e.g. "Waiting for client confirmation" | — |
| Client Company | searchable dropdown | Yes | Active organizations | Locked when opened from an organization's Inquiries tab. Selecting it copies the organization's railway zone and division into the inquiry (not shown on the form) |
| Contact Person | dropdown | Yes | Contacts of the chosen organization, plus "+ Add New Contact" | Disabled until a company is chosen. Must belong to that organization |
| Category | combo box (pick or type) | No | Product Categories list | Typing a new name and choosing "New Category" adds it to the shared list |
| Product | combo box (pick or type) | Yes | Products list (shows category) | Picking a product also fills its category. "New Product" adds the typed name to the shared list |
| Quantity | number | No | — | — |
| Required Delivery Date | date | No | — | — |
| Product Specification | multi-line text | No | — | — |
| Requirement Description | multi-line text | No | — | — |
| Delivery Location | text | No | Under "+ More details" | — |
| Inspection Requirement | text | No | Under "+ More details" | — |
| Warranty Requirement | text | No | Under "+ More details" | — |
| Project Details | multi-line text | No | — | — |

Notes on the inquiry form:
- When a contact is selected, a card shows its name, designation, all mobiles and all emails.
- "+ Add New Contact" opens an inline card: Name (required), Designation, Mobile (+ Add Mobile), Email (+ Add Email), with **Save Contact** / **Cancel**. If the name, mobile or email matches an existing contact, a warning says saving will link to that existing contact instead of creating a new one.
- When a company is picked on a new inquiry, the form warns if the organization already has open inquiries or tenders, listing their IDs ("Make sure you're not creating a duplicate").
- Extra product rows (Category, Product, Quantity, Product Specification) are shown for records that already have additional products (for example from CSV import). They can be edited or removed (×); every filled row needs a Product. The form has no button to add a new extra row.
- The same Category + Product combination entered twice is flagged and blocks saving.
- Errors are shown in a "Cannot Save" dialog with the exact reason.

Tender form (button **Create Tender**). Shows Internal Tender ID (preview TND-YYYYMMDD-NNNN, real number assigned on save) and Internal Tender Creation Date at the top, then a "Tender Information" section.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Lead Source | dropdown | Yes | Same list as inquiries | — |
| Priority | dropdown | Yes | High, Medium (default), Low with meanings | — |
| BD Owner | read-only | — | Logged-in user's name | — |
| Organization | searchable dropdown | Yes | Active organizations | Locked when opened from an organization. Copies railway zone and division from the organization |
| Contact Person | dropdown | No | Organization's contacts plus "+ Add New Contact" | New contact: Name (required), Designation, Mobile, Email. A same-name existing contact is reused instead of creating a new one |
| Tender Number | text | Yes | — | Must be unique for the same railway zone and division (server: "A tender with this number already exists for this zone/division") |
| Tender Name | text | Yes | — | — |
| Tender Authority | text | No | — | — |
| Tender Portal | dropdown | No | GeM, IREPS, CPP Portal, eProcure, Direct, Other | Other shows "Specify portal" |
| Tender Type | dropdown | No | Open, Limited, Single, Global | — |
| Category | text | No | — | — |
| Tender Value | number | No | — | — |
| Currency | dropdown | No | INR (default), USD, EUR | — |
| Status | dropdown | No | Requirement Received (default), Tender Published, Tender Participation, Tender Submitted, Technical Evaluation, Commercial Evaluation, Negotiation, LOA / Order Received, Closed – Ordered, Closed – Not Ordered, Tender Cancelled | — |
| Current Status | multi-line text | No | — | — |
| Publish Date | date | No | — | — |
| Document Download Date | date | No | — | — |
| Pre-Bid Meeting Date | date | No | — | — |
| Query Submission Date | date | No | — | — |
| Submission Date | date | Yes | — | — |
| Technical Opening Date | date | No | — | — |
| Financial Opening Date | date | No | — | — |
| Expected Award Date | date | No | — | — |

The tender record also has fields for participation decision (participate, decided by, decision date, reason for not participating), result (awarded to, LOI number, contract value, loss reason) and workshop. These are kept in the database and appear in the Excel export, but no CRM screen currently shows inputs for them.

#### View page — Inquiry detail (/dashboard/crm/inquiries/[ref], also opened inside the list)

Header: inquiry ID, created date, status, priority and current stage on one line, with the organization name as the title. Opening it adds it to Recently Viewed. If the address has ?back=[page] (for example from an organization's tab), Back returns there.

Header buttons (hidden while editing):

| Button | When it appears / is enabled | What it does |
|---|---|---|
| ← Back | Always | Returns to the list or the page it came from |
| Send Technical Requirement to R&D | Always shown; enabled the first time, and again only after the inquiry has been edited since the last send | Opens the send dialog (see Statuses & workflow). Blocked with a message if Product, or both Specification and Requirement Description, are empty |
| Create Sales Order | Only for users with the Sales app (or admin) and no sales order yet for this inquiry | Opens a new Sales Order pre-filled from this inquiry |
| [SO number] · [SO status] → | Users with the Sales app when a sales order already exists | Opens that sales order in Sales |
| Edit | Creator or admin AND Edit on Inquiries & Tenders | Switches the Info tab into the inquiry form ("✎ Editing Inquiry" badge, Cancel) |
| Delete | Delete on Inquiries & Tenders AND (creator or admin) | Confirm "Delete inquiry [ID]? This action cannot be undone." Soft-deletes the inquiry with its follow-ups and documents |

Under the buttons: "Sent as TOR-… on [date time]" (or "Previously sent as …" once it can be sent again).

Stage progress pill: shows "Stage n of 6", the current stage name and a percentage ring. Clicking opens the stage list; users who can modify the inquiry can click another stage, confirm "Move this inquiry from X to Y?", and the stage is changed.

Tabs: Info, Discussion (only after the Technical Requirement has been sent to R&D), Documents, Quotations, Follow Ups, Timeline. ?tab=discussion (from a mention notification) opens Discussion.

Info tab:
- When the requirement has been changed, a counter and a revision selector appear next to the Info tab. Picking a revision shows a "What changed in this revision" box (old value struck through → new value) and highlights changed fields.
- Current Status card: the free-text current status note.
- Organization card: Name, GST Number, Type, City, State, Address; Contact Person: Name, Mobile, Email, Department.
- Lead Info card: Status and Customer Requirement Priority (these are drop-downs that save immediately for users who can modify the inquiry; read-only text for others; changing them does not re-enable the Send to R&D button), Lead Source, BD Owner, Created On.
- Product Requirement card: Product, Category, Quantity, Required Delivery, Delivery Location, Inspection Req., Warranty Req., Specification, Additional Products (Product, Category, Quantity, Specification for each), Requirement Summary, Project Details.

Discussion tab (shared chat with R&D and departments R&D brought in):
- Two views: Messages (count) and Files (count). Files view lists every file shared in the thread: File, Sent by (with BD / R&D / Design / Electrical / Hydraulic & Pneumatic tag), Sent on, Size.
- Messages: mine on the right, others on the left, with author, side tag, date and time; tagged names highlighted; attached files open on click; **Delete** on your own messages (admins can delete any) with confirmation.
- Composer: message box (type @ to tag someone), **@ Tag people** (search by name or email; only people with CRM, R&D or department Requirements access; you cannot tag yourself), **📎 Attach files** (BD side chooses "Upload new file" or "Already uploaded in the application" which opens a picker of this record's Client and Internal documents with search and folder filter), **Send** (Ctrl+Enter). Up to 10 files per message. A message needs text or at least one file.
- Tagged people get a bell notification linking to the page they can open.

Documents tab:
- A search box filters both folders by file name, category, uploader or date.
- **Client Documents** folder and **Internal Documents** folder. Each lists files newest first with a type badge (PDF, DOC, XLS, PPT, IMG, CAD, ZIP…), name, category, date and time, uploader and size. Clicking opens the file (stored on SharePoint).
- Internal Documents also lists the sent Technical Offer Request PDFs, R&D response files (category "R&D Response") and every quotation as a generated PDF ("Quotation · rev n · generated"), which always opens the current PDF of record.
- Upload area (only for users who can modify the inquiry): pick a Category (from CRM Settings › Document Categories, default "Other"), then click or drag-and-drop files.

Quotations tab — list of quotation cards. Each card shows: quotation number and type (Domestic or Export), revision selector (when revised; picking a revision shows field changes old → new), client name, delivery time, Customer Response, validity, submitted date, discount, conditions, contact, the line items table (Description with details, Model No., Qty, Price/Unit, GST %, Subtotal, Total, Discount and Grand Total) or for lump-sum offers a numbered Particulars list with "Total Price … + GST%", payment terms, notes, and the Word document panel. Card buttons:

| Button | Shown when | What it does |
|---|---|---|
| Customer Response drop-down | User can modify the inquiry (otherwise shown as text) | — Awaiting —, Accepted, Rejected, Negotiating. Saves immediately; does not create a revision |
| Download PDF | Print on Inquiries & Tenders | Downloads [quotation number].pdf (the Word-edited version when one exists) |
| Revise / Cancel | User can modify the inquiry | Opens the full quotation form filled with this quotation; saving makes revision r[n+1] |
| Word panel (Create Word, Edit in Word, Regenerate, Download .docx, History) | Create/edit buttons only for users who can modify | Managed Word document of the quotation on the company letterhead |

Quotation form (**+ Create Quote**, only for users who can modify the inquiry; button **Save Quotation** or **Save Revision**):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Quotation Type | dropdown | Yes | Domestic (INR), Export (USD) | Export hides all GST fields and uses $ |
| GST Type | dropdown | No | CGST + SGST (Intra-state) (default), IGST (Inter-state) | Domestic only |
| Pricing | dropdown | No | Item-wise (price per line) (default), Lump sum (one total price) | Lump sum turns items into a Particulars list |
| Date of Quote | date | Yes | Default today | Moving it moves the default validity with it |
| Technical Offer (R&D) | dropdown | No | R&D Technical Offers for this inquiry ("— No technical offer —"; superseded ones marked) | The latest released offer is pre-selected. Shows the offer date and an **Open PDF** link. A draft offer is rejected by the server. If none exist, a note explains R&D prepares it in R&D › Requirements › Technical Offers |
| Customer/Client | text | Yes | Pre-filled with organization name | — |
| Contact Person Name, Contact Email, Contact Phone | text | No | Pre-filled from the inquiry's contact | — |
| Line Items | repeating rows | Yes (at least one) | Item Name combo box from Products (picking fills model number and default price; "New Product" saves the typed name, model number and price to the Products list) | Each filled row needs an Item Name. Same item with same model number twice is refused. Blank rows are ignored |
| Model No. | text per row | No | — | — |
| Qty | number per row | No | — | Must be more than 0 if entered |
| Price/unit | number per row | No | Item-wise only | Not negative |
| GST % | number per row | No | Item-wise, Domestic only | 0 to 100 |
| Subtotal | read-only | — | Qty × Price | Row total = subtotal + GST |
| Details | multi-line per row | No | Printed under the item, one per line | — |
| Total Price | number | Yes for lump sum | — | More than 0 |
| GST % (lump sum) | number | No | Default 18 | 0 to 100; Domestic only |
| Delivery Time | text | Yes | e.g. "7 days" | Must contain a number and a unit (day, week, month, hour) |
| Quote Validity Date | date | Yes | Default quote date + 30 days | Not before the Date of Quote |
| Discount | number + type (% or INR/USD) | No | Item-wise only | Not negative; percent not above 100; flat not above the items total |
| Quote Conditions | dropdown | Yes for item-wise | Standard T&C, Ex-works, FOR Destination, FOB, CIF, Other/Custom | Other/Custom shows a Custom Quote Conditions box. Not printed on a lump-sum Commercial Offer |
| Payment Terms | combo box (pick or type) | Yes | Payment Terms list | Typing a new text and choosing "New Payment Term" saves it to the list |
| Notes | multi-line | No | — | — |

The live Grand Total (items total minus discount, or lump-sum price plus GST) is shown above the terms. Quotation numbers are QT-[inquiry date-serial]-NN (NN increases per inquiry and is never reused, even after a delete); a revision appends -r1, -r2 and so on.

Follow Ups tab:
- **+ Add Follow Up** (Edit on Inquiries & Tenders) and **Export Meeting MOM** (Print on Inquiries & Tenders).
- Each follow-up row shows activity type, assigned person, created date-time, contact persons with designation, mobile and email, then either MOM rows (observation, action plan, responsibility, target) or remarks, due date ("To Be Decided" if blank) and action plan, plus photo thumbnails.
- Row buttons: **View** (all users), **Edit** (Edit permission; server allows only creator or admin), **Change Status** (Open, Closed, Hold), **Export MoM** (Print permission; downloads MOM_[org]_[date].docx for that one follow-up), **Delete** (Delete permission and own record, or admin).

Follow-up form (Add / Edit):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Subject | text | No | — | — |
| Contact Person(s) | multi-select with search | No | Organization's contacts, plus "+ Add New Contact" (Name and Mobile required, Designation, Department, Email) | First selected contact is stored as the primary contact |
| Activity Type | dropdown | No | Call (default), Email, Meet at Client/Site Office, Meet at Own Office | — |
| Next Follow-up Date | date | No | — | Drives the Overdue / Today counters |
| Status | dropdown | No | Open (default), Closed, Hold | — |
| Attachment | camera / file | No | **📷** takes a photo, **+ Add Photo** picks images | Images only; stored on SharePoint |
| Observation / Remarks | rich text | No | — | — |
| Action Plan | rich text | No | — | — |

The follow-up's Assigned To is set to the logged-in user's name. The **View** dialog shows Created, Subject, Contact Person(s), Next Follow-up Date, Status, Observation / Remarks, Action Plan, Photos and a Minutes of Meeting Word panel.

Export Meeting MOM dialog: Subject (required), Meeting Date (default today), PEW Attendees (pick from all users), Client Attendees (pick from the organization's contacts), Follow-ups to Include (all ticked by default). Buttons **Export Word (.docx)** and **Export PDF** download MOM_[org]_[date].

Timeline tab: one merged history, newest first, each entry with a coloured label: Created, Deleted, Info Update (which fields changed, old → new), Stage ("Moved to stage: …"), Follow Up, Quotation ("Quotation QT-… generated"), Email Sent / Email Failed (Technical Offer Request emails), with the user and date-time.

#### Edit — Inquiry

Clicking **Edit** shows the same inquiry form inside the Info tab with **Save Changes**. All fields can be changed at any status; there is no lock by status. Only the creator or an admin can save (server rule). On save, every changed field is recorded together as one Info Update revision (visible in the revision selector and Timeline). Changing the organization or contact is checked: the contact must belong to the chosen organization. Any edit after the last send re-enables **Send Technical Requirement to R&D**. Additional product rows are fully replaced by what the form sends.

#### View page — Tender detail (/dashboard/crm/tenders/[ref], also opened inside the list)

Header: tender ID and coloured status badge; title is the tender name (or organization name). Next to the stage pill: **← Back**, **Send Technical Requirement to R&D** (enabled first time and after any edit since the last send; no product check for tenders), **Create Sales Order** / sales order chip (users with the Sales app), **Edit** (creator or admin AND Edit), **Delete** (Delete permission and own record, or admin). "Sent as TOR-… on …" is shown under the buttons.

Stage pill: "Stage n of 7" with the tender stages; users who can modify can change it after confirmation.

Tabs: Info, Discussion (after sending to R&D), Documents, Dates, Follow Ups, Timeline.

Info tab:

| Card | Field | Meaning |
|---|---|---|
| Current Status | note | Free-text current status |
| Tender Details | Status | Drop-down that saves immediately for users who can modify; text for others |
| Tender Details | Tender No., Authority, Portal, Type, Category | As entered |
| Tender Details | Value, Currency | Tender value with currency |
| Tender Details | Current Stage | Current tender stage |
| Organization | Name, Railway Zone, Division | Organization and the zone/division copied to the tender |
| Contact Person | Name, Mobile, Email, Department | Selected contact |

A revision selector shows what changed in each edit, as for inquiries.

Dates tab: Milestone / Date table — Publish Date, Document Download, Pre-Bid Meeting, Query Submission, Submission Date, Technical Opening, Financial Opening, Expected Award.

Documents, Discussion, Follow Ups and Timeline tabs work exactly as on the inquiry (tenders have no quotations, so no generated quotation PDFs and no Quotation timeline entries).

#### Edit — Tender

**Edit** shows the tender form inside the Info tab ("✎ Editing Tender", Cancel, **Save Changes**); the stage pill stays visible. All fields are editable at any status; only the creator or an admin can save. Changes are recorded as Info Update revisions; any edit re-enables Send to R&D.

#### Statuses & workflow — Inquiries

Inquiry Status (set by the user in the form or the Lead Info drop-down): Requirement Received → R&D / Technical Review → Qualified → Quotation Sent → Order Received → Under Production → Closed - Ordered / Closed - Not Ordered. Any status can be picked at any time; the server only checks the value is in this list.

Inquiry Stage (stage pill): 1 Requirement Received, 2 Requirement Qualified, 3 Quotation Sent, 4 Negotiation, 5 Order Received, 6 Closed – Not Ordered. Stage is changed by the creator or an admin with Edit permission; each change writes a timeline entry.

Main flow:
1. BD creates the inquiry (number INQ-YYYYMMDD-NNNN). The "Inquiry created" notification rule fires if switched on in Settings.
2. BD clicks **Send Technical Requirement to R&D**. The dialog requires: Response Due Date (not in the past), optional Remarks to R&D, optional reference Client documents, and a Technical Offer Word document made with **Create Word** (it can be edited in Word first). **Send** generates the PDF (number TOR-[inquiry date-serial]), saves it on SharePoint under Internal Documents, emails it as an attachment to the R&D mailbox with time-limited links to the reference documents, records the send on the Timeline, opens a request to the R&D head(s) with a bell notification "Technical Offer Request TOR-… for R&D", returns to the Info tab and makes the Discussion tab available. A re-send supersedes the previous open request. If no active R&D head exists the send is refused with an explanation.
3. R&D answers in R&D › Requirements (late answers need a delay reason); BD gets a bell notification "R&D responded to …" and R&D's files appear in Internal Documents. R&D's released Technical Offer becomes selectable in the quotation.
4. BD creates the Quotation, downloads or edits it in Word, records the Customer Response, and revises it as needed.
5. BD creates the Sales Order from the inquiry. When Sales confirms it, CRM automatically sets the inquiry to status "Closed - Ordered" and stage "Order Received", and writes a timeline and audit entry naming the Sales Order.

#### Statuses & workflow — Tenders

Tender Status: Requirement Received, Tender Published, Tender Participation, Tender Submitted, Technical Evaluation, Commercial Evaluation, Negotiation, LOA / Order Received, Closed – Ordered, Closed – Not Ordered, Tender Cancelled (free choice from the list).

Tender Stage (stage pill): 1 Tender Published, 2 Documents Downloaded, 3 Participate Decision, 4 Bid Submitted, 5 Technical Qualified, 6 Financial Opened, 7 Awarded / Lost.

Flow is the same as inquiries for sending to R&D, discussion, follow-ups and Sales Order. When the Sales Order is confirmed, the tender becomes status "Closed – Ordered" and stage "Awarded / Lost". Tenders whose status is not one of the three closed/cancelled values count as Pending Tenders on the dashboard.

#### Statuses & workflow — Follow-ups

Follow-up status: Open, Closed, Hold, changed with **Change Status** or in the form. Only Open follow-ups count on the dashboard; Open with a past due date is Overdue.

### Technical Offer Request viewer — /dashboard/crm/technical-offer/[ref]

A plain page titled "Technical Offer Request" that loads one CRM document by its signed reference. A PDF is shown inline with a **Download document** link; other file types show only the download link. It needs a logged-in user but not CRM access, so R&D users can open it. Errors: "You do not have access to this document." or "This document could not be loaded — it may have been removed." No link to this page was found elsewhere in the current code (the Technical Offer Request email uses a direct signed download link instead).

## 4. Settings / Masters

Route: /dashboard/crm/settings, title "CRM settings", **← Back** to the CRM Dashboard. Viewing needs View on CRM › Settings; changing anything needs Edit on CRM › Settings.

### Lists used in CRM forms

Four list buttons; ?section=products, product-categories, payment-terms or document-categories opens one directly. Changes appear in the forms immediately.

| List | Fields (form) | Table columns | Used in | Rules |
|---|---|---|---|---|
| Products | Name (required), Model Number, Category, Unit, Default Price, Description | Name, Model No., Category, Unit, Default Price | Inquiry Product picker (with category); quotation Item Name picker (fills model number and default price) | **+ Add Product**, Edit, Delete. Delete only by an admin, the person who added it, or for rows with no creator |
| Product Categories | Name (required) | Name | Inquiry Category picker | **+ Add Product Category**, Edit, Delete (same delete rule) |
| Payment Terms | Label (required), Description / Terms Text | Label, Description | Quotation Payment Terms picker (the description text is put into the quotation) | **+ Add Payment Term**, Edit, Delete (same delete rule) |
| Document Categories | Category Name (required, max 100) | Category, Documents (how many files use it) | Category picker when uploading Client / Internal documents | Renaming re-labels the documents already filed under it. Deleting removes it from the picker; existing documents keep the label. "Other" is the default and fallback |

New products, categories and payment terms can also be created on the fly from the inquiry and quotation forms.

### Notification rules

One rule group per CRM event. Each group has: **Send this notification** (on/off, default off), **Notify these people** (user picker), **Channels** (Portal bell, Email, Microsoft Teams; default Portal bell), **Also email these addresses** (extra addresses such as a team mailbox, sent whenever the rule is on). The person who did the action is not notified. **Reset to default** is available per field. The save bar shows "Save [n] changes".

| Event | Sent when |
|---|---|
| Organization created | A new organization is added in CRM |
| Inquiry created | A new inquiry is created |
| Tender created | A new tender is created |
| Discussion message | Anyone (BD or R&D) posts in a requirement Discussion (people tagged in it are notified anyway). Recipients may be CRM or R&D users |

Validation: a rule that is on must have at least one person or email address; if people are selected, at least one channel must be ticked; extra addresses must be valid emails.

## 5. Permissions

CRM uses the Permission Matrix keys crm:[tab]:[action], on top of CRM app access.

| Tab key | Actions available | What they gate |
|---|---|---|
| crm:dashboard | view | Dashboard tab and its data |
| crm:organizations | view, create, edit, delete, export, import | Organizations list and detail; Add Organization; Edit organization and its contacts; Delete; Excel export; CSV import (import also requires the admin role) |
| crm:inquiries_tenders | view, create, edit, delete, approve, reject, export, print | List and detail; New Record; Edit, stage change, quotations, follow-ups and Send to R&D (edit); Delete; Excel export; quotation PDF, Technical Offer PDF and MoM exports (print). Approve and reject exist in the matrix but no CRM screen uses them |
| crm:settings | view, edit | Settings page; editing lists and notification rules |

Extra rules applied by the server and screens:
- Edit (organization, inquiry, tender, contact, follow-up, quotation create) is allowed only to the record's creator or an admin, in addition to the Edit permission.
- Delete follows the company rule: Delete permission AND the record was created by you; admins can delete anything.
- Quotation revise: the quotation's creator or an admin. Customer Response: the inquiry owner, the quotation creator or an admin. Quotation delete: admin only (no button on screen).
- Data scope: users see only records in their CRM data scope. A record is "own" if they created it; "assigned" if their name is the inquiry's BD Owner, Sales Engineer or follow-up assignee, the tender's BD Owner, or the follow-up's Assigned To; an organization is "assigned" if the user has an inquiry or tender on it. Follow-ups are also visible when the parent inquiry, tender or organization is visible.
- The Organizations list API is also open to users with Accounts access (customer master).
- CSV import and the duplicate organizations report are admin only.
- Discussion: open to users with CRM, R&D or a department's Requirements access on records shared with them; you can delete only your own messages (admins any).
- Create Sales Order button: users with the Sales app or admins.

## 6. Documents, Notifications & Integrations

### Generated documents

| Document | Where | Format | Notes |
|---|---|---|---|
| Quotation | Quotations tab, Internal Documents | Managed Word document (Create Word, Edit in Word, Regenerate, Download .docx, History) and PDF (Download PDF) | PDF is the current PDF of record, including Word edits. Stored in SharePoint folder CRM-Quotations. A new revision marks the old Word draft out of date |
| Technical Offer Request (TOR) | Send to R&D dialog; filed in Internal Documents | Managed Word draft, sent as PDF | Number TOR-[record date-serial]. Saved on SharePoint under CRM-media |
| Follow-up Minutes of Meeting | Follow-up row Export MoM; View dialog Word panel | Word (.docx) | One follow-up per document |
| Meeting MOM | Export Meeting MOM dialog | Word (.docx) or PDF | Combines chosen follow-ups with PEW and client attendees |
| R&D Technical Offer | Quotation form, Open PDF | PDF | Prepared and released by R&D |
| Excel exports | Organizations and Inquiries & Tenders lists | .xlsx | Columns listed in the list sections above |
| CSV import template | Import dialog | .csv | crm_bulk_import_template.csv |

Uploaded files (client/internal documents, follow-up photos, discussion files) are stored on SharePoint; only their details are stored in the portal.

### Notifications

- Notification rules from CRM Settings (bell, email, Teams as configured): organization created, inquiry created, tender created, discussion message.
- Bell notification to each person @tagged in a requirement Discussion.
- Bell notification to the R&D head(s) when a Technical Requirement is sent ("Technical Offer Request TOR-… for R&D", with due date and remark).
- Bell notification to the BD sender when R&D responds ("R&D responded to …", on time or late with delay reason).
- Email to the R&D mailbox with the TOR PDF attached and secure, time-limited links to the TOR and chosen reference documents. The send is recorded on the Timeline as Email Sent or Email Failed; if the email fails, the inquiry or tender is not marked as sent and the error is shown.
- The code also raises "created", "updated" and "deleted" broadcast notices for organizations, inquiries and tenders, but these types are switched off app-wide, so they are not delivered.

### Links to other modules

- **R&D:** Send Technical Requirement creates an R&D request (R&D › Requirements); the Discussion thread is shared with R&D and departments R&D brings in (Design, Electrical, Hydraulic & Pneumatic); R&D's Technical Offers feed the quotation's Technical Offer field.
- **Sales:** Create Sales Order opens a Sales Order pre-filled from the inquiry or tender; confirming it closes the CRM record as ordered.
- **Accounts:** Organizations act as the customer master (credit limit, credit days, discount and GL account fields live on the organization record, managed outside these CRM screens).
- **Products:** CRM uses its own Products and Product Categories lists in Settings; these are still separate from the Product Management module's finished-product master.
