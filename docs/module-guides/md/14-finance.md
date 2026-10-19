# Finance & Accounting Module

The Finance & Accounting module (app key **accounts**, shown in the portal as "Finance") is the company's double-entry book of accounts, built on Indian accounting rules: the financial year runs 1 April to 31 March, vouchers are numbered per financial year (for example JV/2026-27/0001), statements follow Schedule III of the Companies Act, GST is split into CGST + SGST or IGST by place of supply, and depreciation follows Schedule II. It holds the chart of accounts, vendors, bank and cash accounts, purchase and sales invoices, debit and credit notes, payment and receipt vouchers, bank reconciliation, GST registers and returns, closing-stock valuation, the fixed-asset register, and every financial report up to the year-end close. Finance is the last step of the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → **Finance**): vendor bills are booked against Purchase Orders and goods received in Store (3-way match), sales invoices are raised to CRM customers (organizations), closing stock is valued from Store quantities, and every rupee that moves in the business ends up as a posted voucher here. Every figure in a report is computed live from posted journal lines.

## 1. Navigation Tabs

The sub-nav (FinanceNav) sits at the top of every Finance page. A tab is shown only if the user may view at least one of the Permission Matrix tabs behind it (listed in Section 5). On the right of the sub-nav are the guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Masters | /dashboard/finance/masters | Masters & Setup: Company & FY, Account Groups, Ledgers, Ledger Settings, GST Rates, Bank & Cash, Vendors, Internal Orders, Opening Balances |
| Journals | /dashboard/finance/ledger | Journal Vouchers, Day Book, Ledger Statement, Period Close (plus the single-voucher screen /dashboard/finance/ledger/voucher) |
| Purchase | /dashboard/finance/purchase | Purchase Invoices and Debit Notes |
| Sales | /dashboard/finance/sales | Sales Invoices and Credit Notes |
| Payments | /dashboard/finance/payments | Payments & Receipts (vendor payments, customer receipts, expense payments, other receipts, contra) |
| Bank & Cash | /dashboard/finance/banking | Accounts overview, Bank / Cash Book, Reconciliation (BRS), Liquidity Forecast |
| GST | /dashboard/finance/gst | Registers, GSTR-1, GSTR-3B, ITC Set-off |
| Outstanding | /dashboard/finance/outstanding | Receivables (customers) and Payables (vendors), party-wise and aged |
| Inventory | /dashboard/finance/inventory | Stock Value, Purchase / Sales Impact, Closing Stock |
| Assets | /dashboard/finance/assets | Fixed-asset Register and Depreciation |
| Reports | /dashboard/finance/reports | Trial Balance, Profit & Loss, Balance Sheet, Cash Flow, Aging, Budget Variance, Monthly Pack, Year-end Close |

Two other routes exist but are not tabs: /dashboard/finance (redirects straight to Masters) and /dashboard/finance/ar-ap (the old AR/AP page, now redirects to Purchase).

## 2. Dashboard

The Finance module has **no dashboard page**. Opening /dashboard/finance immediately redirects to Finance › Masters. Summary figures are spread across the module instead:

### Summary cards found inside the screens
- Bank & Cash › Accounts: Total at Bank, Total Cash in Hand, Total Liquid Funds, and one card per bank/cash account with its book balance.
- Outstanding: Total outstanding, Overdue, Advances, Net for receivables or payables.
- Reports › Monthly Pack: one-page month-end summary (trial balance, P&L, balance sheet, AR/AP aging).
- Reports › Profit & Loss: Total income, Total expenses, Gross profit, Profit/Loss for the period.

**Actions:** none on /dashboard/finance itself — it only redirects.

## 3. Screens

Common behaviour on every Finance screen:
- Every page starts with the sub-nav, then a page title and a one-line subtitle, then in-page sub-tabs (pill buttons). On Masters, Journals, Purchase, Sales, Bank & Cash, Assets and Reports the sub-tabs are filtered by permission (a sub-tab the user cannot view is hidden). On Payments, GST, Outstanding and Inventory all sub-tabs are always shown once the page itself is open.
- Blue info banners explain the accounting rule behind the screen; amber banners are warnings; red banners show the real error message returned by the server.
- Amounts are shown in Indian format with two decimals; dates as dd-mm-yyyy.
- "Maker-checker": for journals, purchase invoices, sales invoices and debit/credit notes, the person who recorded a document can never post or approve it. Their row shows "Posted by another finance user (maker-checker)" or "Awaiting another user" instead of the Post button.
- Draft documents that are waiting in the approval engine show an amber badge "Awaiting approval · <stage>" or a purple "Returned for changes" badge, and their expanded row shows the Approval Panel (approve / reject / history) from Organization › Approval Workflows.
- Finance Manager means a user with the **Finance Manager** flag ticked on their user record (or an admin). Several actions need this flag in addition to the tab permission.

### Masters › Company & FY (/dashboard/finance/masters, sub-tab "Company & FY")

Read-only. Financial years and the company GSTIN are maintained in Organization › Company Info (Financial Year and Legal & Registration tabs); Finance only reads them.

#### View page
Warnings from the setup (for example a missing GSTIN) appear as amber banners at the top.

Card "Current financial year":

| Field | Meaning |
|---|---|
| Year | FY code covering today, e.g. 2026-27 ("No financial year covers today" if none) |
| Period | Start and end date of that FY |
| Status | Open / Closed / Locked |
| Lock date | Date on or before which nothing can be posted, or "Not set" |
| Source | "Defined in Company Info", or "Assumed (statutory Apr–Mar) — not defined yet" |

Card "Company GST registration":

| Field | Meaning |
|---|---|
| GSTIN | Company GSTIN, or "Not set" |
| State | State code and name derived from the GSTIN, or "Unknown" |
| Note | Our state vs the party's state decides CGST + SGST (same state) or IGST (different state) |

Table of all financial years: Financial year (current one marked "(current)"), Start, End, Status, Lock date.

**Actions:** "Open Company Info →" button and a link in the banner, both go to /dashboard/organization/info.

### Masters › Account Groups

The group tree that decides where a ledger appears in the Balance Sheet / P&L (Schedule III).

#### List view

| Column | What it shows |
|---|---|
| Group | Group name indented by tree depth (└ for sub-groups) plus its code |
| Nature | Asset, Liability, Capital / Equity, Income or Expense (inherited from the top group) |
| Schedule III head | The statutory head the group reports under |
| Gross profit | "Yes" if ledgers in this group count in the trading (gross profit) view |
| Ledgers | Number of ledgers directly in the group |
| Type | System (standard, fixed group) or Custom |
| (actions) | + Sub-group, Edit, Delete |

Top button: **+ New Sub-group** (needs Account Groups create). Row actions: **+ Sub-group** (create, pre-fills this group as parent), **Edit** (edit permission), **Delete** (shown only for a custom group with no ledgers and no sub-groups, and only with delete permission; asks for confirmation "Only empty custom groups can be deleted").

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Parent group | searchable dropdown | Yes | All groups, shown as full path | Every new group sits under an existing one |
| Nature (inherited) | read-only | — | From the parent | A sub-group always inherits its parent's nature |
| Code | text | Yes | Free text, placeholder "G-…" | Must be unique ("Group code already exists") |
| Name | text | Yes | Free text | |
| Schedule III head | dropdown | No | "Same as parent (…)" or any Schedule III head from setup | Must be a known head |
| Affects gross profit | dropdown | No | Same as parent / Yes / No | |
| Sequence | number | No | Default 0 | Sort order among siblings |

#### Edit
Parent and Code are locked. Name and Sequence can be changed. Schedule III head can be changed only on a custom group; on a standard (system) group it is disabled ("A standard group's Schedule III head is fixed — create a sub-group with its own head instead"). Affects gross profit is not shown on edit.

#### Statuses & workflow
No statuses. Standard groups can never be deleted ("reports depend on them"); a group with ledgers or sub-groups cannot be deleted.

### Masters › Ledgers

The chart of accounts (GL ledgers).

#### List view
Filters: **Search** (code or name), **Group (incl. sub-groups)** (searchable; filtering by a group also includes all its descendants), **Status** (All / Active / Inactive). A counter shows "N of M ledgers". Rows are grouped under a shaded group-path heading row; ledgers with no group appear under "No group (legacy) — edit to assign one".

| Column | What it shows |
|---|---|
| Code | Ledger code |
| Name | Ledger name, plus sub-type in brackets if set |
| Type | Asset / Liability / Capital / Equity / Income / Expense (from the group) |
| Flags | "Posting" or "Header", plus "Control" for a control account |
| Status | Active / Inactive |
| (actions) | Edit, Delete |

Top button: **+ New Ledger** (Ledgers create). Row actions: **Edit** (edit permission), **Delete** (delete permission; confirmation says a ledger with postings can't be deleted — set it inactive instead).

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Group | searchable dropdown | Yes | All account groups (full path) | Decides where the ledger shows in BS / P&L |
| Type (from group) | read-only | — | Nature of the chosen group | Ledger type always equals its group's nature |
| Code | text | Yes | Free text | Unique ("GL account code already exists") |
| Name | text | Yes | Free text | |
| Sub-type (optional) | text | No | Free text | |
| Posting | dropdown | No | "Yes — vouchers post here" / "No — header only" | Vouchers can only post to posting ledgers |
| Control account | dropdown | No | No / "Yes — sum of a party sub-ledger" | A control account needs a vendor or customer on every journal line |
| Status | dropdown | No | Active / Inactive | Inactive ledgers can't be posted to |

Opening balances are not typed here; the banner links to the Opening Balances tab.

#### Edit
All fields editable. A ledger that already has postings cannot change type (moving it to a group of different nature is refused, because it would restate past statements). Delete is refused if the ledger has postings or is referenced elsewhere.

### Masters › Ledger Settings

Which ledger the system uses for each automatic posting (account determination).

#### List view

| Column | What it shows |
|---|---|
| Role | The posting role (list below) |
| Current ledger | Code — name of the linked ledger (red "Not found — pick a ledger" if missing) plus a Default / Changed pill |
| Standard code | The ledger code the role uses by default |
| Change to | Searchable dropdown of active posting ledgers; picking one saves immediately |
| (action) | "Reset to default" (only when changed) |

Roles and default codes: Sundry Creditors control (2010), Sundry Debtors control (1130), CGST Input Credit (1151), SGST Input Credit (1152), IGST Input Credit (1153), CGST Output (2021), SGST Output (2022), IGST Output (2023), GST Payable under Reverse Charge (2024), Round Off (5800), Purchases default (5001), Sales default (4000), Closing Stock / Stock-in-Hand (1140), Changes in Inventories (5050), Retained Earnings (3010), Depreciation expense (5400), Accumulated Depreciation (1030), Profit on Sale of Fixed Assets (4120), Loss on Sale of Fixed Assets (5610).

#### Edit
Only a Finance Manager (or admin) who also has Ledger Settings edit can change a role; others see a warning banner and disabled dropdowns. A change affects new postings only; past vouchers stay where they were posted. Every change is written to the audit log.

### Masters › GST Rates

#### List view

| Column | What it shows |
|---|---|
| Rate | GST % |
| Description | Free text, or "—" |
| Status | Active / Inactive |
| (actions) | Edit description, Activate / Deactivate |

Banner: from 22-Sep-2025 the slabs are 0%, 5%, 18% and 40%; 12% and 28% are kept as inactive rates for older documents. An inactive rate stops appearing on new invoice lines.

#### Create form (inline row, shown only to a Finance Manager with GST Rates create)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Rate % | number | Yes | 0–100 | Must be between 0 and 100; duplicate rate refused ("re-activate it instead") |
| Description | text | No | e.g. "Standard rate" | |
| Status | dropdown | No | Active / Inactive | |

Button: **+ Add Rate**.

#### Edit
Only description (inline Save / Cancel) and active status can change, and only by a Finance Manager with GST Rates edit. The rate itself cannot be edited.

### Masters › Bank & Cash

Each bank or cash account and the GL ledger it posts to.

#### List view

| Column | What it shows |
|---|---|
| Kind | Bank or Cash |
| Name | Bank name / cash account name |
| Account no. | Bank account number |
| IFSC / Branch | IFSC and branch |
| Ledger | Linked GL ledger code (red "Not linked" if none) |
| Balance per books (₹) | Balance of the linked ledger |
| Status | Active / Inactive / Closed |
| (actions) | Edit, Delete |

Top button: **+ New Account** (create permission). Delete (delete permission) is refused if the account has vouchers ("set its status to closed instead").

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Kind | dropdown | Yes | Bank / Cash | Changing kind clears the ledger |
| Bank name / Account name | text | Yes | e.g. "HDFC Bank" or "Head Office Cash" | |
| Account no. | text | Yes for bank | Bank only | Unique |
| Account holder | text | No | Bank only | |
| IFSC | text | No | Bank only, max 11, auto-uppercase | |
| Branch | text | No | Bank only | |
| GL ledger | searchable dropdown | Yes | Active asset posting ledgers that are not control accounts; ledgers in "Bank Accounts" (or "Cash-in-Hand") group listed first | Each ledger can be linked to only one bank/cash account |
| Status | dropdown | No | Active / Inactive / Closed | Only active accounts can be used in vouchers |

#### Edit
All fields editable, except that the GL ledger cannot change once the account has vouchers.

### Masters › Vendors

The vendor master (shared with Procurement). Vendors are a sub-ledger of Sundry Creditors.

#### List view
Search: code, name, GSTIN or city.

| Column | What it shows |
|---|---|
| Code | Vendor code |
| Name | Vendor name |
| GST type | Regular / Composition / Unregistered / Overseas (import) / SEZ |
| GSTIN | GSTIN or "—" |
| City / State | City and state |
| Payment days | Credit period in days |
| Status | Active / Inactive / Blocked |
| (actions) | Edit, Delete |

Top button: **+ New Vendor**. Delete is refused if the vendor has invoices or ledger entries ("set it to inactive or blocked instead").

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Code | text | Yes | Free text | Unique ("Vendor code already exists") |
| Name | text | Yes | Free text | |
| GST registration | dropdown | No (default Regular) | Regular, Composition, Unregistered, Overseas (import), SEZ | |
| GSTIN | text (15, uppercase) | Yes for Regular (label shows * for Regular, Composition, SEZ) | | Format and check digit validated; a Regular vendor without GSTIN is refused |
| PAN | text (10, uppercase) | No | | Auto-filled from GSTIN characters 3–12 if left blank |
| Status | dropdown | No | Active / Inactive / Blocked | Blocked vendors cannot be billed or paid |
| Address | text | No | | |
| City | text | No | | |
| State (place of supply) | searchable dropdown | No | Indian GST state names from setup | Used for CGST/SGST vs IGST when there is no GSTIN |
| PIN | text (6) | No | | |
| Contact name / phone / email | text | No | | |
| Bank name, Bank account no., IFSC, Account holder | text | No | IFSC auto-uppercase | |
| Credit limit (₹) | number | No | ≥ 0 | |
| Payment days | number | No | ≥ 0 | Used to default bill due dates |
| Default expense ledger | searchable dropdown | No | Active expense posting ledgers | |

#### Edit
All fields editable.

### Masters › Internal Orders

An internal order collects the cost of one job or project (capital build, major repair) across many vouchers so actual spend can be compared with budget, independent of the cost center.

#### List view

| Column | What it shows |
|---|---|
| Code | Order code |
| Name | Order name |
| Type | Capital / Maintenance / IT / Training |
| Cost center | Linked cost center or "—" |
| Period | Start – end date |
| Budget (₹) | Budgeted amount |
| Status | Open / In Progress / Completed / Closed |
| (actions) | Edit, Delete |

Top button: **+ New Internal Order**. Delete is refused if posted journal lines reference it ("close it instead").

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Code | text | Yes | | Unique |
| Name | text | Yes | | |
| Order type | dropdown | No (default Capital) | Capital, Maintenance, IT, Training | |
| Start date / End date | date | No | | |
| Budget (₹) | number | No | ≥ 0 | Used in Reports › Budget Variance |
| Cost center | dropdown | No | Cost centers (Organization) | |
| Status | dropdown | No | Open, In Progress, Completed, Closed | |
| Description | multi-line text | No | | |

#### Edit
All fields editable.

### Masters › Opening Balances

A one-time screen that posts a single Opening Balance voucher (series OB) dated the first day the books start in the system.

#### Create form
Header:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Opening date (first day of books) | date | Yes | Defaults to the current FY start date | |
| Narration | text | No | Default "Opening balances" | |

Section "Ledger balances" (rows added with **+ Add ledger**, removed with ✕):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Ledger | searchable dropdown | Yes per row | Active posting ledgers that are not control accounts and not income/expense | Control accounts must be entered bill-wise; income/expense start every year at zero |
| Debit (₹) / Credit (₹) | number | One of them | Typing in one clears the other | |

Section "Vendor bills unpaid on the opening date (credit — we owe)" (**+ Add vendor bill**): Vendor (non-inactive vendors), Bill no., Bill date (defaults to opening date), Due date (defaults to bill date + vendor payment days), Amount due. Each bill needs vendor, number and amount > 0; cannot be dated after the opening date; a bill number already in the system is refused.

Section "Customer invoices unpaid on the opening date (debit — owed to us)" (**+ Add customer invoice**): Customer (CRM organizations), Invoice no., Invoice date, Due date (defaults to invoice date + customer credit days, 30 if not set), Amount due. Same rules as vendor bills.

Totals panel: Total debits (ledger debits + customer invoices), Total credits (ledger credits + vendor bills), Difference ("Balanced" or the amount more debit / more credit).

**Actions:** **Post Opening Balances** — enabled only for a Finance Manager with Opening Balances edit, when debits equal credits, at least one balance is entered and the date is set. A confirmation explains it can only be done once. On success a green banner shows the voucher number and total; party bills then appear in Outstanding and aging.

#### Statuses & workflow
Can be posted only once — a second attempt is refused until the existing opening voucher is reversed.

### Journals › Journal Vouchers (/dashboard/finance/ledger)

Manual journals (maker-checker) and a list of every voucher in the books.

#### List view
Top: **Open voucher no.** box (e.g. JV/2026-27/0001) with **Open** button — opens that voucher's screen, or shows an error if the number doesn't exist. **+ New Journal** (Journal Vouchers create).

Filters: Status (Draft / Posted / Reversed / Discarded), Voucher Type (Journal, Payment, Receipt, Contra, Purchase, Sales, Debit Note, Credit Note, Opening), Posting Type (Adjustment, Accrual, Correction, Depreciation, Invoice, Payment, Receipt, Contra, Debit Note, Credit Note, Opening, GST Set-off, Closing Stock, Asset Disposal, Year End), From, To, and **Clear**.

| Column | What it shows |
|---|---|
| Entry No. | Voucher number (or "Draft"); click the row to expand |
| Date | Posting date |
| Voucher | Voucher type |
| Posting Type | Posting type, plus "auto-reverses <date>" for accruals |
| Description | Narration, plus "Reversed <date>: <reason>" if reversed |
| Amount (₹) | Total debit |
| Status | Draft / Posted / Reversed / Discarded, plus approval badge on drafts |
| Created / Posted By | Maker and "posted: <name>" |
| (actions) | See below |

Row actions:
- Draft: **Submit for approval** (submit permission, when not already pending); **Post** (approve permission, not the maker; confirmation "Posting gives it a JV number…"); maker sees "Awaiting another user"; **Discard** (delete permission; draft is kept as Discarded for audit).
- Posted: **Reverse** (Finance Manager or admin with Journal Vouchers reject permission). If not allowed the cell explains why: "Reversal entry", "Finance Manager reverses", or "Correct via source" (entries posted by an invoice, note, payment, depreciation run, asset, valuation, year-end or closing stock must be corrected through that document).

Expanded row: "Open voucher →" link (non-drafts), maker note, Approval Panel (drafts), and the lines table: Ledger, Cost Centre, Party (Vendor/Customer), Remarks, Dr, Cr, Total.

Other Finance pages link here with ?entry=<signed ref>, which auto-expands that voucher. An edited or invalid link shows the "Invalid link" screen with "Back to journals".

#### Create form ("New Journal (saved as draft)")

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Posting Date | date | Yes | Default today | Must be in an open FY and open period, after any lock date |
| Posting Type | dropdown | Yes | Adjustment, Accrual, Correction, Depreciation | Only these manual types allowed |
| Auto-reverse On | date | For Accrual | Defaults to 1st of next month | Must be after the posting date |
| Description / Narration | text | No | | |

Lines (starts with two; **+ Add line**; ✕ when more than two):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Ledger | searchable dropdown | Yes | Active posting ledgers | Not inactive, not header |
| Party (control a/c) | searchable dropdown | Yes when the ledger is a control account | Vendors and customers | A line can name a vendor or a customer, not both |
| Cost Centre | searchable dropdown | No | Cost centers | |
| Debit (₹) / Credit (₹) | number | Exactly one | Typing in one clears the other | No negatives |
| Remarks | text | No | | |

A Balanced / Difference pill shows under the totals. **Save Draft** is enabled only when total debit = total credit > 0. At least two lines. After saving, if the user has submit permission the draft is sent straight to its approvers; if that fails, a message says it was saved as a draft and why it couldn't be sent.

#### Statuses & workflow
- Draft → Posted: posted by "Post" (approve permission, not the maker) or by the approval engine when the "Manual journal voucher" workflow is approved. Posting assigns the JV number and updates every ledger. An accrual posts its reversal automatically dated on the auto-reverse date.
- Draft → Discarded: Discard, or rejection in the approval engine.
- Posted → Reversed: Reverse dialog with **Reason (required)** and **Reversal date (blank = today)**; a new journal with Dr/Cr swapped is posted, original stays marked Reversed. A reversal cannot be dated before the original and cannot itself be reversed.
- Posting is refused into a closed period or locked date.

### Journals › Single voucher screen (/dashboard/finance/ledger/voucher?entry=…)

Opened from Journals, Day Book, Ledger Statement, Inventory and Assets links.

#### View page
Header: voucher number (or "Draft journal"), subtitle "<voucher type> voucher · <posting type>", buttons **Change** and **← Back**.

| Field | Meaning |
|---|---|
| Status | Draft / Posted / Reversed / Discarded |
| Posting date | Date posted |
| Period / FY | Accounting period (YYYY-MM) and FY code |
| Amount | Total debit |
| Source | The document that posted it (Vendor invoice, Sales invoice, Debit / credit note, Payment voucher, Depreciation run, Fixed asset, Closing-stock valuation, with where it lives) or "Manual journal" |
| Drafted by | Maker and date |
| Posted by | Poster |
| Auto-reverses on | For accruals |
| Reverses | Link to the original voucher (on a reversal) |
| Reversed | Link to the reversal, date, who, reason (on a reversed voucher) |
| Narration | Description |

Lines table: #, Ledger, Cost Centre, Party, Remarks, Dr, Cr, Total.

History table: When, Who, What (Drafted, Submitted, Posted, Discarded, Reversed, Text changed, Approved, Rejected), Details (old → new text for changes).

A draft shows a note to approve or discard it from Journals.

#### Edit
**Change** appears only on a Posted or Reversed voucher for users with Journal Vouchers edit. Only the narration and the line remarks can be edited (they move no money); ledger, amount, party, cost centre and date are corrected by reversal. Save is refused if nothing changed. Each change is logged in History with old and new text.

### Journals › Day Book

Every posted voucher in date order.

#### List view
Filters: From (default 1st of this month), To (default today), Voucher Type; **Show** button.

| Column | What it shows |
|---|---|
| Date | Posting date |
| Voucher No. | Link to the voucher screen |
| Type | Voucher type, plus Reversed pill |
| Particulars | Narration on the header row; under it one row per line ("To <ledger>" for credits, indented) with remarks |
| Dr (₹) / Cr (₹) | Line amounts |

Footer: "Total — N voucher(s), value <total>" with total Dr and Cr.

### Journals › Ledger Statement

#### List view
Filters: Ledger (active ledgers; choosing one loads immediately), From (default FY start), To (default today), **Show**.

Stat cards: Opening, Total Dr, Total Cr, Closing (shown as amount Dr/Cr).

| Column | What it shows |
|---|---|
| Date | Posting date (first row = opening balance) |
| Voucher No. | Link to the voucher screen |
| Type | Voucher type |
| Particulars | Narration |
| Dr / Cr | Amounts |
| Balance | Running balance, Dr or Cr |

Footer: totals and closing balance on the To date.

### Journals › Period Close

Locks an accounting month.

#### View page
Panel: **Accounting Period** dropdown (last 18 months), status pill Open / Closed, "by <name> on <date>" when closed, approval badge when a close is pending.

Buttons:
- Not closed, user has Period Close approve: Finance Manager/admin sees **Close <Mon YYYY>**; others see **Request close of <Mon YYYY>** (disabled as "Close requested" while pending). Opens a prompt for optional notes.
- Not closed, no approve permission: text "You need the Approve permission on Period Close to close a period."
- Closed: admin sees **Reopen** (prompt with required reason); others see "Only an admin can reopen a closed period."

Approval Panel for that period's close request. History table (click a row to select that period): Period, Status, Closed By, Notes, Reopened (who, when, reason).

#### Statuses & workflow
Open → Closed via the "Accounting period close" approval workflow (default stage: a Finance Manager; a Finance Manager's own click closes at once, anyone else's request waits). Close is refused if the month hasn't ended, its closing-stock valuation is still a draft, or any purchase invoice, sales invoice, debit/credit note or draft journal dated in it is unposted. Closed → Open only by an admin, with a reason (audit-logged).

### Purchase › Purchase Invoices (/dashboard/finance/purchase)

Vendor bills, either against a PO (3-way match with PO and GRN) or direct (services/expenses).

#### List view
Top button: **+ Record purchase invoice** (create permission). Filters: Status (Pending / Posted / Cancelled), Payment (Unpaid / Part paid / Paid), Type (Against PO / Direct / Opening), Vendor.

| Column | What it shows |
|---|---|
| Bill no. | Vendor's bill number; click to expand |
| Date / Due | Bill date and due date |
| Vendor | Vendor name, plus "PO <number>" |
| Type | Against PO / Direct / Opening |
| Taxable (₹) | Taxable value |
| GST (₹) | Total GST with IGST or C + S split, and an RCM badge for reverse charge |
| Total (₹) | Invoice total |
| Due (₹) | Amount still payable |
| Match | Matched / Variance / Variance approved / No PO |
| Status | Pending / Posted / Cancelled, approval badge (pending), payment status Unpaid / Part paid / Paid (posted) |
| Journal | Posted journal number |
| (actions) | See below |

Row actions:
- **Approve variance** — pending bill with Variance, Finance Manager with Purchase Invoices approve, not the maker; prompt for optional note.
- **Post** — pending bill without variance, approve permission, not the maker.
- **Submit for approval** — pending bill not already in approval, submit permission.
- **Cancel** — pending bill, delete permission; reason required. A posted bill is never cancelled — it is corrected with a debit note.
- **Pay** — posted bill with amount due, Payments create permission; opens Payments with the vendor pre-selected.

Expanded row: Approval Panel; lines table (#, Description, HSN/SAC, Qty, Rate, Discount, Taxable, GST %, IGST or CGST + SGST, Ledger); vendor GSTIN, place of supply, reverse charge note, round-off, "PO qty · GRN accepted · Invoiced", variance approval (who, note), narration, cancel reason, recorded by / posted by; **Settlement history** (date, Payment or Debit note number, amount).

#### Create form ("Record purchase invoice")
Mode toggle: **Against PO** / **Direct (no PO)**.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Purchase order | searchable dropdown | Yes (Against PO) | POs in status issued, acknowledged, partially fulfilled or fulfilled | PO must be linked to an approved purchase requisition; goods must have been accepted on a GRN; total invoiced on the PO cannot exceed the approved PO value (before GST) + 1%. Shows the matched vendor, or a red note if no vendor master matches |
| Vendor | searchable dropdown | Yes (Direct) | Non-blocked vendors | Blocked vendors refused |
| Vendor bill no. | text | Yes | As printed on the bill | The same bill number from the same vendor can't be booked twice |
| Bill date | date | Yes | Default today | Must fall in an open FY / period |
| Due date (optional) | date | No | Blank = bill date + vendor payment days (shown) | |
| Place of supply | dropdown | Yes | GST state codes; defaults to the company's state | Vendor state vs place of supply decides CGST+SGST or IGST |
| Round-off (₹) | number | No | Default 0 | Must be less than ₹1 either way |
| Reverse charge (RCM) | checkbox | No | | Vendor is paid only the taxable value; GST goes to RCM payable and is claimed back as input credit |
| Lines | line editor | At least one | Description, HSN/SAC, Qty, Unit, Rate, Discount, GST % (active GST rates), Ledger (blank = default Purchases / vendor default), Taxable (computed) | Ledger must be active posting, not a control account; invoice value > 0 |
| Narration | multi-line text | No | | |

Live panels: taxable / CGST / SGST or IGST / invoice value preview, "Payable to vendor" (excluding GST under RCM), and for Against PO a **3-way match** box (green "within tolerance" or red "variance — needs approval") showing PO qty, GRN accepted, already invoiced, received value, approved PO value and the variance reasons. Tolerances: quantity 2%, amount 1%. Warnings: a Composition or Unregistered vendor's bill must have 0% GST unless RCM (enforced by the server); a vendor with no GSTIN or state blocks the GST split.

Buttons: **Close**, **Record invoice**. After saving, the bill is sent for approval automatically if the user has submit permission.

#### Edit
No edit after recording. A pending bill can only be posted, approved or cancelled; a posted bill is corrected by a debit note.

#### Statuses & workflow
- Pending → Posted: Post, or the "Purchase invoice" approval workflow (stage 1 "3-way-match variance (Finance Manager)" only when the bill has a variance; stage 2 "Posting approver" = anyone with Purchase Invoices approve; no self-approval). Posting creates the purchase journal (series PI) and the bill becomes payable.
- Matching: Matched / Variance → Variance approved (Finance Manager) / No PO (direct). A Variance bill cannot be posted until approved.
- Pending → Cancelled: Cancel with reason, or rejection in approval.
- Payment status: Unpaid → Part paid → Paid as payments and debit notes are settled against it.

### Purchase › Debit Notes

Purchase returns and reductions of a vendor bill (rate difference, discount, shortage). Series DN.

#### List view
Top button: **+ Raise debit note**.

| Column | What it shows |
|---|---|
| Note no. | Number (or "Draft"); click to expand |
| Date | Note date |
| Vendor | Party name |
| Against bill | Original purchase invoice number |
| Reason | Goods returned / Rate difference / Discount / Deficiency / shortage / Other |
| Taxable, GST, Total (₹) | Amounts |
| Unadjusted (₹) | Amount not yet set off (posted notes) |
| Status | Pending / Posted / Cancelled plus approval badge |
| (actions) | Submit for approval, Post (not the maker, approve permission), Cancel (delete permission, reason required) — pending notes only |

Expanded row: Approval Panel, lines table, vendor GSTIN, place of supply, round-off, narration, raised by.

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Against purchase invoice | searchable dropdown | Bill or vendor required | Posted purchase invoices, or "No specific bill (vendor only)" | Must be a posted bill; note can't be dated before it; notes against a bill can't exceed its taxable value. "Copy lines from invoice" fills the lines |
| Vendor | searchable dropdown | When no bill | All vendors | Vendor needs GSTIN or state |
| Note date | date | Yes | Default today | |
| Reason | dropdown | Yes | Goods returned, Rate difference, Discount, Deficiency / shortage, Other | |
| Round-off (₹) | number | No | | Less than ₹1 |
| Lines | line editor | Yes | Same as invoice lines (default ledger Purchases) | Value > 0 |
| Narration | multi-line text | No | | |

A warning shows if the bill was under reverse charge. Buttons: **Close**, **Save debit note** (auto-submitted for approval if allowed).

#### Statuses & workflow
Pending → Posted (Post or "Debit note" approval workflow; no self-approval) — reverses input GST and is set off against the bill automatically. Pending → Cancelled (reason, or rejection). A posted note is undone with a fresh opposite document.

### Sales › Sales Invoices (/dashboard/finance/sales)

GST tax invoices to customers (CRM organizations). Series SI.

#### List view
Top button: **+ New sales invoice**. Filters: Status (Draft / Issued / Cancelled), Collection (Uncollected / Part received / Overdue / Received), Customer.

| Column | What it shows |
|---|---|
| Invoice no. | SI number (or "Draft"); click to expand |
| Date / Due | Invoice date and due date |
| Customer | Customer name |
| GSTIN | Customer GSTIN or "Unregistered" |
| POS | Place of supply state code |
| Taxable / Tax / Total (₹) | Amounts; Tax shows IGST or CGST + SGST |
| Due (₹) | Amount still to collect (issued only) |
| Overdue | Days overdue |
| E-docs | IRN and EWB badges if recorded |
| Status | Draft / Issued / Cancelled, approval badge, collection status |
| (actions) | See below |

Row actions: **Submit for approval** (draft, submit permission); **Issue / Post** (draft, approve permission, not the maker); **Cancel** (draft only, delete permission, reason required — an issued invoice is corrected with a credit note); **E-invoice / e-way bill** (any non-cancelled invoice, edit permission); **Receive** (issued with amount due, Payments create — opens Payments with the customer pre-selected).

Expanded row: Approval Panel, lines table, CGST/SGST or IGST, round-off, customer PO no. and date, Bill to, Ship to, narration, cancel reason, drafted by; E-invoice block (IRN, Ack no., Ack date, E-way bill no., date, vehicle); Receipt history (issued invoices).

#### Create form ("New sales invoice", saved as a draft)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Customer | searchable dropdown | Yes | CRM organizations; shows GSTIN and credit days (30 default) | Customer GSTIN must be valid |
| Invoice date | date | Yes | Default today | Must fall in an open FY |
| Place of supply | dropdown | Yes | GST state codes; auto-set from customer GSTIN/state, else company state | Decides CGST+SGST vs IGST; refused if it can't be determined |
| Customer PO no. | text | No | | |
| Customer PO date | date | No | | |
| Billing address | multi-line text | No | Auto-filled from the customer's address | |
| Shipping address | multi-line text | No | Blank = same as billing; "Copy billing address" link | |
| Lines | line editor | Yes | Description, HSN/SAC, Qty, Unit, Rate, Discount, GST %, Ledger (default Sales) | Value > 0; ledger active posting, not control |
| Round-off (₹) | number | No | | Less than ₹1 |
| Narration | multi-line text | No | | |
| E-invoice / e-way bill (collapsible, optional) | fields | No | IRN, Ack no., Ack date, E-way bill no., E-way bill date, Vehicle no. | IRN exactly 64 characters; e-way bill exactly 12 digits; vehicle auto-uppercase |

Invoice total shown live. Buttons: **Close**, **Save draft** (auto-submitted for approval if allowed).

#### Edit
Lines and amounts cannot be edited after saving. Only the e-invoice / e-way bill details can be updated via the dialog (they don't change any amount).

#### Statuses & workflow
- Draft (pending) → Issued (posted): Issue / Post or the "Sales invoice" approval workflow (no self-approval). The SI/FY/NNNN number is given only at this point so the series has no gaps (GST Rule 46).
- Draft → Cancelled: Cancel with reason or rejection.
- Collection: Uncollected → Part received → Received; Overdue when past due date.

### Sales › Credit Notes

Sales returns and reductions of an issued invoice. Series CN.

#### List view
Top button: **+ Issue credit note**. Columns and actions are the same as Debit Notes (Customer, Against invoice, Reason, Taxable, GST, Total, Unadjusted, Status Draft / Posted / Cancelled, Submit / Post / Cancel). Expanded row shows Approval Panel, lines, customer GSTIN, place of supply, narration, raised by.

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Against sales invoice | searchable dropdown | Yes | Issued (posted) sales invoices | Must name the original invoice (GSTR-1). Shows "GST reducible until <30 Nov after the invoice's FY>" and "Copy lines from invoice" |
| Note date | date | Yes | Default today | Not before the invoice. After the deadline, GST must be 0% (server refuses otherwise; a warning banner appears) |
| Reason | dropdown | Yes | Same reasons as debit notes | |
| Round-off (₹) | number | No | | Less than ₹1 |
| Lines | line editor | Yes | Default ledger Sales | Notes can't exceed the invoice's taxable value |
| Narration | multi-line text | No | | |

#### Statuses & workflow
Same as debit notes, via the "Credit note" approval workflow. Posting reduces output GST and is set off against the invoice.

### Payments & Receipts (/dashboard/finance/payments)

One voucher model for all money movements. Vouchers are posted immediately (no draft or approval).

#### List view
Sub-tabs (filters): All, Vendor Payments, Customer Receipts, Expense Payments, Other Receipts, Contra. Filters: From (default FY start), To (default today), Status (Posted / Cancelled).

| Column | What it shows |
|---|---|
| (caret) | Click row to expand |
| Number | PV / RV / CV number |
| Date | Payment date |
| Type | Vendor payment / Customer receipt / Expense payment / Other receipt / Contra |
| Party / ledgers | Vendor or customer, or the split ledgers, or "Bank/cash transfer" |
| Bank / cash | Account used (→ receiving account for contra) |
| Mode / ref | Cheque, NEFT, RTGS, IMPS, UPI, Cash, Demand Draft, with cheque or reference no. |
| Amount (₹) | Voucher amount |
| Unallocated (₹) | Advance not yet set against bills |
| Bank reco | Unreconciled / Reconciled / Cleared |
| Status | Posted / Cancelled |
| (actions) | Allocate, Cancel |

Row actions: **Allocate** (posted vendor/customer voucher with unallocated amount, Payments edit) opens the Allocate dialog; **Cancel** (posted, not reconciled, Payments reject) asks for a required reason, reverses the journal and releases all settled bills; reconciled vouchers show "Reconciled" and cannot be cancelled.

Expanded row: narration, cheque date, reference, cleared date, recorded by; Ledger lines (expense/other receipt); Bills settled (bill, date, amount, **Remove** for posted vouchers with edit permission — bill becomes due again, amount returns to the voucher as an advance, no journal change).

Allocate dialog: open bills of the party (Bill no., Date, Due, Overdue days, Due amount, Allocate input, **Max**), "Fill oldest first", total vs available; refuses over-allocation.

#### Create form ("New voucher", button **+ New voucher** — Payments create)
Opening Payments from Outstanding, Purchase (Pay) or Sales (Receive) opens this form with the party pre-selected.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Voucher type | dropdown | Yes | Vendor payment (PV), Customer receipt (RV), Expense payment (PV), Other receipt (RV), Contra — bank/cash transfer (CV) | |
| Vendor / Customer | searchable dropdown | Yes for vendor/customer types | Non-blocked vendors / CRM organizations | Blocked vendor refused |
| Date | date | Yes | Default today | |
| Amount (₹) | number | Yes | | > 0 |
| Paid from / Received into / From (paying) account | searchable dropdown | Yes | Active bank & cash accounts with book balance | Account must be active and have a GL ledger. Cash can't go below zero |
| To (receiving) account | searchable dropdown | Yes for contra | Other bank/cash accounts | Must differ from the paying account |
| Mode | dropdown | Yes | Cash only for a cash account; Cheque, NEFT, RTGS, IMPS, UPI, Demand Draft for a bank | Cash mode needs a cash account |
| Cheque no. / Cheque date | text / date | Cheque no. required for cheque | | |
| UTR / reference | text | No | Not shown for cash | |
| Open bills (vendor/customer) | table with Settle amount per bill | No | Party's open bills; "Pay/Receive in full", "Auto-settle oldest first" | Settle ≤ bill due; total ≤ voucher amount; the rest stays as an advance |
| Expense / income ledger lines (expense / other receipt) | line table | Yes | Ledger (not control, not bank/cash), Amount, Cost centre, Remarks; "+ Add line", "Use full amount" | Lines must add up to the voucher amount |
| Narration | text | No | | |

Shows existing unadjusted credits of the party. A warning on Expense payment says GST bills should be booked as a direct purchase invoice instead (else input credit is lost). Buttons: **Post voucher**, **Clear**, **Close**. A success dialog shows the number and any amount left as advance.

#### Statuses & workflow
Posted on save (journal created). Posted → Cancelled with reason (not if reconciled). Reconciliation status changes via Bank & Cash › Reconciliation.

### Bank & Cash › Accounts (/dashboard/finance/banking)

#### View page
Stat cards: Total at Bank, Total Cash in Hand, Total Liquid Funds (sum of book balances of active accounts). One card per active account: name, account no., IFSC, branch, Bank/Cash pill, Book balance (Dr/Cr, red if negative), linked ledger code.

**Actions:** "Open bank book →" / "Open cash book →" switches to the Bank / Cash Book tab for that account.

### Bank & Cash › Bank / Cash Book

#### List view
Filters: Bank / Cash Account, From (default 1st of month), To, **Show**. Stat cards: Opening, Receipts (Dr), Payments (Cr), Closing. Table: Date, Voucher No., Type, Particulars, Receipts (₹), Payments (₹), Balance — with opening row and totals row. An account without a linked ledger shows an error.

### Bank & Cash › Reconciliation (BRS)

#### Create form ("Start a Reconciliation", Reconciliation create)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Bank Account | searchable dropdown | Yes | Bank accounts only | Cash accounts can't be reconciled; account needs a GL ledger; only one in-progress reconciliation per account |
| Statement Date | date | Yes | Default today | |
| Statement Closing Balance (₹) | number | Yes | As per bank | |

#### View page (active reconciliation)
Title "<account> — statement as on <date>", status pill (In Progress / Completed), completed by/on, **Close**.

Summary: Balance as per books; Add: cheques issued, not yet paid by bank; Less: deposits not yet credited by bank; Expected balance as per bank; Balance as per bank statement; Difference (must be 0 to complete).

Uncleared vouchers table (in progress only): select checkbox, Date, Voucher No., Direction (Deposit / Withdrawal), Party / Narration, Mode, Cheque / Ref No., Amount. Field **Bank (clearing) date** (blank = statement date; can't be after statement date or before the voucher date). Buttons: **Mark N as Cleared** (edit), **Complete Reconciliation** (edit; enabled only when difference is zero; confirmation). Net of selected is shown.

History table: Bank Account, Statement Date, Book, Statement, Difference, Status, **Open**.

#### Statuses & workflow
In Progress → Completed (difference must be zero; record locked). Ticked vouchers become Reconciled and can no longer be cancelled.

### Bank & Cash › Liquidity Forecast

Read-only projection. Stat card: Current Cash & Bank. Table: Period (Overdue, 0–30 Days, 31–60 Days, 61+ Days), Inflows — AR, Outflows — AP, Net, Projected Balance (red if negative). Built from today's balances plus open receivables and payables by due date.

### GST › Registers (/dashboard/finance/gst)

#### List view
Filters: Register (Sales (output) / Purchase (input)), From (default 1st of month), To, **Show**.

| Column | What it shows |
|---|---|
| Doc type | Invoice / Credit note / Debit note |
| Number, Date | Document number and date |
| Party, GSTIN | Party and GSTIN (or "Unregistered") |
| Place of supply | State |
| RCM | "Yes" for reverse charge |
| Taxable, CGST, SGST, IGST, Total | Amounts (credit notes / debit notes shown negative) |

Totals row with document count.

### GST › GSTR-1

Working figures for the monthly outward-supply return. **Return period (month)** + **Refresh**. Warnings from the server appear as amber banners. Collapsible sections (count in brackets):
- 4A — B2B invoices (open by default): GSTIN, Party, Invoice no., Date, Place of supply, RCM, Invoice value, then one sub-row per rate (Rate %, Taxable, CGST, SGST, IGST); totals.
- 5 — B2C Large: inter-state invoices to unregistered buyers above ₹1,00,000 (same columns).
- 7 — B2C Small: Place of supply, Type (Inter/Intra-state), Rate %, Taxable, CGST, SGST, IGST; totals.
- 9B — CDNR and CDNUR: credit notes to registered / unregistered buyers (GSTIN, Party, Note no., Date, Against invoice, Place of supply, Note value, rate breakup).
- 12 — HSN-wise summary: HSN/SAC ("Missing" in amber if none), UQC, Rate %, Quantity, Taxable, CGST, SGST, IGST.
- 13 — Documents issued (open by default): Sr. no. from, to, Total issued, Cancelled, Net issued.

Filing itself happens on the GST portal.

### GST › GSTR-3B

**Return period** + **Refresh**. A server note appears as an amber banner. Table rows: 3.1(a) Outward taxable supplies; 3.1(c) Nil rated / exempt; 3.1(d) Inward supplies liable to reverse charge; 4(A)(3) ITC on reverse charge; 4(A)(5) All other ITC; 4(B) ITC reversed (debit notes); 4(C) Net ITC available (bold). Columns: Taxable value (3.1 rows only), IGST, CGST, SGST.

### GST › ITC Set-off

Monthly utilisation of input credit against output tax in CGST Rule 88A order.

#### View page
**Return period**, **Refresh**, **Post set-off** (Finance Manager with GST edit; disabled if already posted or nothing to set off; others see "Only a Finance Manager can post the set-off").

Stat cards: Cash payable (as of period end), Credit carried forward. Tables: Ledger balances at period end (IGST, CGST, SGST input and output; RCM payable); Utilisation (Step, Credit of, Paid against, Amount); Cash payable after set-off (IGST, CGST, SGST, RCM cash only, Total); Credit carried forward (IGST, CGST, SGST).

#### Statuses & workflow
Posting creates one GST set-off journal dated at period end (Dr output tax, Cr input credit). Only once per period — reverse that journal first to redo. The cash portion is paid separately through Payments › Expense payment.

### Outstanding (/dashboard/finance/outstanding)

#### List view
Sub-tabs: Receivables (customers), Payables (vendors). Stat cards: Total outstanding, Overdue, Advances received / paid, Net.

| Column | What it shows |
|---|---|
| Customer / Vendor | Party name; click to open party detail |
| Open bills | Count |
| Outstanding (₹) | Total due |
| Not due, 1–30, 31–60, 61–90, >90 | Aged by due date |
| Overdue (₹) | Past due |
| Advances (₹) | Unallocated payments and unadjusted notes |
| Net (₹) | Outstanding − advances (= party balance in the control account) |

Totals row.

#### View page (party detail)
Header with party name and Outstanding · Overdue · Advances · Net. Buttons: **Record payment / Record receipt** (opens Payments with the party pre-selected), **Close**.

Sections: Open bills (Bill no., Date, Due date, Days overdue, Bucket, Bill total, Settled, Due); Open credits (Document, Kind: Advance (voucher) / Debit note / Credit note, Date, Amount, Available to allocate); Statement with From (default FY start) and To (Date, Voucher no., Type, Description, Debit, Credit, Balance, opening and closing rows, and a note on what the balance sign means).

### Inventory › Stock Value (/dashboard/finance/inventory)

Live value of stock on hand in Store (including quarantine). Stat cards: Stock value (as of date), Items in stock, Items without cost (red if any). Tables: By category (Category, Items, Value, Total) and Items (Code, Item, Category, Qty, UoM, Rate, Value, Rate source: Moving avg / Standard cost / Manual / No cost). A server note may appear as a warning.

### Inventory › Purchase / Sales Impact

From (FY start), To, **Show**. Stat cards: Purchases (taxable), Sales (taxable). Table: Item / description, Purchase qty, Purchase value, Sales qty, Sales value, totals. Built from posted purchase and sales invoices; lines linked to a Store item are grouped by item.

### Inventory › Closing Stock

Periodic inventory (AS-2): month-end closing stock posted from Store values.

#### Create form ("New valuation")

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Period (month) | month | Yes | Default current month | One valuation per period |
| Notes | text | No | | |

Button **Create draft from Store** (Inventory edit).

#### List view
Period, Valuation date, Closing stock (₹), Status (Draft / Posted / Cancelled), Journal (link), Notes, **Open** / **View**.

#### View page
Header: "Closing stock <period>", status, valuation date, item count, journal link, notes. Buttons: **Post closing stock** (Finance Manager with Inventory edit, draft only; confirmation: Dr Stock-in-Hand / Cr Changes in Inventories, auto-reverses next day as next month's opening stock), **Cancel valuation** (Finance Manager, not cancelled; reason required), **← Back**. Stat card Closing stock value. Lines: Code, Item, Category, Qty, UoM, Rate, Value, Rate source.

#### Edit
On a draft, Qty and Rate are inline-editable (save on leaving the cell or Enter; no negatives; an edited rate becomes Manual). Posted valuations cannot be edited — cancel and re-create.

#### Statuses & workflow
Draft → Posted (Finance Manager; value must be > 0) → Cancelled (posted entry and its next-day reversal undone by counter-entries). Draft → Cancelled. A draft valuation blocks the period close.

### Assets › Register (/dashboard/finance/assets)

#### List view
Filter **Show**: Active (default) / Disposed / All. Top button **+ Register asset** (Fixed Assets create). Stat cards: Cost, Accumulated depreciation, Net book value.

| Column | What it shows |
|---|---|
| Code | Asset code |
| Name | Name and location |
| Cost ledger | Asset GL ledger |
| Put to use | Date |
| Cost (₹) | Cost |
| Method | "SLM N months" or "WDV N%" |
| Acc. dep. (₹) | Accumulated depreciation |
| Book value (₹) | Cost − accumulated depreciation |
| Depreciated to | Last depreciation date or "Not yet" |
| Status | Active / Disposed (with disposal date and proceeds) |
| (actions) | Edit (edit permission), Dispose (active, Finance Manager with edit), Delete (active, never depreciated, delete permission) |

#### Create form ("Register a fixed asset")

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Asset code | text | Yes | e.g. FA-0001 | Unique |
| Name | text | Yes | | |
| Location | text | No | | |
| Description | text | No | | |
| Asset cost ledger | searchable dropdown | Yes | Asset ledgers (fixed-asset groups first) | |
| Accumulated depreciation ledger | searchable dropdown | No | Default (Ledger Settings) or asset ledgers | |
| Depreciation expense ledger | searchable dropdown | No | Default (Ledger Settings) or expense ledgers | |
| Cost centre | searchable dropdown | No | Cost centers | |
| Purchase date | date | Yes | Default today | |
| Put to use date | date | Yes | Default today | Not before purchase date |
| Cost (₹) | number | Yes | | > 0 |
| Residual value (₹) | number | No | Default 0 | ≥ 0 and less than cost |
| Method | dropdown | Yes | Straight line (SLM) / Written-down value (WDV) | |
| Useful life (months) | number | Yes for SLM | e.g. 180 for plant & machinery | > 0 |
| WDV rate (% p.a.) | number | Yes for WDV | e.g. 18.10 | Between 0 and 100 |
| Opening accumulated dep. (₹) | number | No | For assets brought from old books | Not more than cost − residual |

Registering does not book the purchase; the purchase is booked through a purchase invoice to the asset ledger.

#### Edit
Edit dialog changes only Name, Description, Location and Cost centre. Cost, dates and method are locked.

Dispose dialog: Disposal date (required; after put-to-use and after the last depreciation date), Sale proceeds (₹), Proceeds ledger (required if proceeds > 0; bank/cash first). **Dispose & post** charges depreciation up to the disposal date, removes cost and accumulated depreciation, and posts the profit or loss on sale.

#### Statuses & workflow
Active → Disposed. Delete only if never depreciated or disposed.

### Assets › Depreciation

#### View page
**Month**, **Preview**, and **Run depreciation** (Finance Manager with Depreciation approve) or **Request depreciation run** (others with approve); disabled when the preview total is zero. Without approve permission: a note. Approval Panel for that month's run request.

Preview table: Asset, From, To, Days, Depreciation (₹), Book value now (₹), Total. Runs table: Month (click to expand per-asset lines: Asset, Days, Book value before, Depreciation), Run date, Amount, Assets, Status (Posted / Reversed), Journal link, **Reverse** (Finance Manager, newest posted run only; reason required).

#### Statuses & workflow
Run goes through the "Depreciation run" approval workflow (default: a Finance Manager; a Finance Manager's click posts at once). Posts one journal (Dr depreciation expense / Cr accumulated depreciation), pro-rata by days. Runs must go in month order; one per month; reversed newest first; a run can't be reversed if an asset in it has since been disposed.

### Reports › Trial Balance (/dashboard/finance/reports)

Common to the range reports (Trial Balance, P&L, Balance Sheet, Cash Flow, Budget Variance): From (default FY start), To (default today), and quick buttons This month / Last month / This FY / Last FY. Reports reload automatically. **Print** button (top right) appears when the user has print permission on the tab.

Table grouped by primary group (with subtotals): Code, Ledger, Group, Opening Dr, Opening Cr, Debit, Credit, Closing Dr, Closing Cr; Grand total row (green when balanced, red when not) and a Balanced / Out of balance pill. Clicking a ledger opens a side drawer with that ledger's statement for the same range (Opening, Debits, Credits, Closing cards; Date, Voucher, Narration, Debit, Credit, Balance).

### Reports › Profit & Loss

Stat cards: Total income, Total expenses, Gross profit (trading), Profit/Loss for the period. Schedule III statement: I Revenue from operations, II Other income, III Total income, IV Expenses (by head), Total expenses, V Profit before tax, VI Tax expense, VII Profit/Loss for the period. Click a head to fold out its ledgers.

### Reports › Balance Sheet

Only the "As at" date applies. Sections with numbered subsections and lettered heads (click to see ledgers), section totals, Balanced pill (or Difference in red). A banner explains the "Surplus in the Statement of Profit & Loss (not yet closed)" when the year isn't closed, and a warning when assets ≠ equity & liabilities.

### Reports › Cash Flow

Indirect method (AS-3): A Operating, B Investing, C Financing (lines and nets), net change, opening and closing cash, and a check line (reconciles / difference).

### Reports › Aging

Sub-tabs Receivables (AR) / Payables (AP), link "Open outstanding & party statements →". Party-wise table: Customer/Vendor, Bills, Not due, 1–30, 31–60, 61–90, > 90, Outstanding, Advances, Net, totals. Bill-wise detail (oldest due first): Bill no., Party, Due date, Days overdue, Amount due, Bucket; total due. As of today.

### Reports › Budget Variance

Table: Type (Cost centre / Internal order), Code, Name, Budget, Actual, Variance (red when overspent), Variance %. A cost centre's annual budget is pro-rated to the months in the range; an internal order's budget is compared as is.

### Reports › Monthly Pack

**Month** picker. Cards: Trial balance (total debit, credit, closing Dr/Cr, balanced pill); Profit & loss (income, expenses, gross profit, profit before tax, profit for the period); Balance sheet as at month end (total assets, equity & liabilities, P&L surplus not yet closed, difference); Receivables / payables aging (outstanding with bill count, overdue, over 90 days). An aging note appears as a warning.

### Reports › Year-end Close

#### View page
Warning banner with the pre-close checklist (post/cancel all pending documents and draft journals, post closing stock, run depreciation, post March GST set-off). **Financial year** dropdown (status shown for non-open years) with its dates and lock date. Panel: status pill, Net profit/loss for the year, Closing voucher (or "Not closed"), explanation text.

Buttons: **Close financial year** (Finance Manager/admin with Year-end Close approve) or **Request year-end close** (others with approve); without permission a note. When closed: **Reopen year** (admin only; reason required). Approval Panel for the FY close.

#### Statuses & workflow
Open → Closed via the "Financial year close" approval workflow (default: Finance Manager). Posts one year-end voucher on the FY end date zeroing every income and expense ledger into Retained Earnings; no further postings can be dated in the year. Refused if anything dated in the year is unposted or there is nothing to close. Closed → Open: admin reopen, which reverses the closing voucher (audit-logged).

## 4. Settings / Masters

All settings live under Finance › Masters:

- **Company & FY** — read-only view of financial years, lock dates and company GSTIN, maintained in Organization › Company Info.
- **Account Groups** — Schedule III group tree; controls where ledgers report and which count towards gross profit.
- **Ledgers** — chart of accounts; posting/header and control-account flags.
- **Ledger Settings** — which ledger each automatic posting uses (AP/AR control, GST input/output, RCM, round-off, default purchase/sales, stock, retained earnings, depreciation, disposal gain/loss). Finance Manager only.
- **GST Rates** — the GST % values offered on invoice lines. Finance Manager only.
- **Bank & Cash** — accounts used in vouchers and their ledgers.
- **Vendors** — vendor master (shared with Procurement); GST registration drives input-credit rules; payment days drive due dates.
- **Internal Orders** — project/job cost collectors with budgets.
- **Opening Balances** — one-time opening voucher.

Approval workflows for the eight finance transaction types are configured centrally in Organization › Approval Workflows (Manual journal voucher, Purchase invoice, Sales invoice, Debit note, Credit note, Accounting period close, Depreciation run, Financial year close). An admin-only endpoint exists to rebuild ledger balances (no screen in Finance).

## 5. Permissions

Module app key: **accounts** ("Finance & Accounting"). Access to any Finance page needs app access to accounts. Permission Matrix tabs and their actions:

| Tab key | Label | Actions | Group (nav tab) |
|---|---|---|---|
| company_fy | Company & FY | view, edit | Masters |
| account_groups | Account Groups | view, create, edit, delete | Masters |
| ledgers | Ledgers | view, create, edit, delete, export, import | Masters |
| ledger_settings | Ledger Settings | view, edit | Masters |
| gst_rates | GST Rates | view, create, edit, delete | Masters |
| bank_cash_accounts | Bank & Cash Accounts | view, create, edit, delete | Masters |
| vendors | Vendors | view, create, edit, delete, export, import | Masters |
| internal_orders | Internal Orders | view, create, edit, delete | Masters |
| opening_balances | Opening Balances | view, edit, import | Masters |
| journal_vouchers | Journal Vouchers | view, create, edit, delete, submit, approve, reject, cancel, export, print | Journals |
| day_book | Day Book | view, export, print | Journals |
| ledger_statement | Ledger Statement | view, export, print | Journals |
| period_close | Period Close | view, edit, approve | Journals |
| purchase_invoices | Purchase Invoices | view, create, edit, delete, submit, approve, reject, cancel, export, print | Purchase |
| debit_notes | Debit Notes | same as purchase invoices | Purchase |
| sales_invoices | Sales Invoices | same as purchase invoices | Sales |
| credit_notes | Credit Notes | same as purchase invoices | Sales |
| payments | Payments & Receipts | view, create, edit, delete, approve, reject, export, print | Payments |
| bank_book | Bank / Cash Book | view, export, print | Bank & Cash (also gates the Accounts overview) |
| reconciliation | Reconciliation (BRS) | view, create, edit, delete, export | Bank & Cash |
| liquidity | Liquidity Forecast | view, export, print | Bank & Cash |
| gst | GST Registers & Returns | view, edit, export, print | GST |
| outstanding | Receivables & Payables | view, export, print | Outstanding |
| inventory | Stock Value & Closing Stock | view, edit, export, print | Inventory |
| fixed_assets | Asset Register | view, create, edit, delete, export | Assets |
| depreciation | Depreciation | view, approve, export | Assets |
| financial_reports | Financial Reports | view, export, print | Reports |
| year_end_close | Year-end Close | view, approve | Reports |

How actions map to buttons:
- create → "+ New / Record / Raise / Issue" buttons; edit → Edit links, e-invoice details, allocations, BRS matching, voucher text change; delete → Delete / Discard / Cancel of unposted documents; submit → "Submit for approval"; approve → Post / Issue, Period Close, Depreciation run, Year-end Close; reject → Reverse journal (with Finance Manager), Cancel payment voucher; print → Reports Print button.

Extra rules on top of tab permissions:
- **Finance Manager flag (or admin) required** to: change Ledger Settings, add/change GST rates, post Opening Balances, reverse a journal, approve a 3-way-match variance, post the GST set-off, post or cancel closing stock, dispose of an asset, reverse a depreciation run, and to close a period / run depreciation / close a year directly (others with approve only submit a request).
- **Admin only**: reopen a closed accounting period, reopen a closed financial year, rebuild ledger balances.
- **Maker-checker**: the creator of a journal, purchase invoice, sales invoice or note cannot post, approve, or approve the variance on it.
- **Data scope**: journals, purchase and sales invoices, notes, payment vouchers and reconciliations are scoped by creator (a role without a Finance scope sees own + assigned records; set "Entire organization" for full Finance data). Masters and aggregate reports are not scoped.

## 6. Documents, Notifications & Integrations

### Documents
- The Finance module generates **no Word or PDF documents**. The only output is the browser **Print** button on Financial Reports (navigation and filters are hidden in print). GSTR-1 / GSTR-3B are on-screen working figures to key into the GST portal; e-invoice IRN and e-way bills are generated on the government portals and only recorded here.

### Voucher numbering
Per financial year, format PREFIX/FY/NNNN: JV (journal), PV (payment), RV (receipt), CV (contra), PI (purchase), SI (sales invoice — issued only on posting), DN (debit note), CN (credit note), OB (opening). Drafts carry a temporary DRAFT number.

### Notifications
All Finance notifications come from the central approval engine:
- When a document or process is submitted (journal, purchase invoice, sales invoice, debit/credit note, period close, depreciation run, year-end close), each approver of the active stage (and their delegates) gets "Approval needed: <title>" as a bell notification **and a Teams message**. The same applies when a request is handed over or escalated, and overdue reminders are sent.
- When a request is approved or rejected, the requester gets a bell-only notification.
- Bell notifications link to the Finance page for the entity type (accounts_journal_entry, accounts_vendor_invoice, accounts_ar_transaction, accounts_party_note, accounts_period_close, accounts_depreciation_run, accounts_year_end_close).
- No emails are sent by Finance. Key actions (posting, cancelling, ledger setting changes, reopen, voucher text changes) are written to the audit log.

### Links to other modules
- **Organization › Company Info** — financial years, lock dates, company GSTIN (read by Finance).
- **Organization › Approval Workflows** — approval stages for the eight finance transaction types.
- **Organization › Cost Centers** — cost centres on journal lines, payment split lines, internal orders, assets and budget variance.
- **Procurement / Purchase Orders and Store GRN** — purchase invoices "Against PO" use the PO, its approved requisition, and GRN accepted quantities for the 3-way match; vendor master is shared.
- **CRM › Organizations** — customers for sales invoices, credit notes, receipts and opening customer bills (GSTIN, state, address, credit days).
- **Store** — stock quantities and moving-average / standard costs feed Stock Value and Closing Stock.
- Within Finance, posted documents link to their journal voucher, and Outstanding / Purchase / Sales open Payments with the party pre-selected.
