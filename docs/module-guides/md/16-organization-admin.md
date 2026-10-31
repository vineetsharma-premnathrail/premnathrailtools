# Organization & Administration Module

The Organization module is the administration area of the portal. It holds the company master (company info, legal and tax registrations, financial years, branding, partners), the plant/branch master (with its addresses, stores, cost centers, user postings and documents), departments and their heads, the list of portal users, roles and the Permission Matrix (who may see and do what, and which records they see), the central Approval Workflows engine (who approves each kind of document in every module), approval delegations, session/security policy, and the audit trail. It is not a step in the business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance); it is the foundation every step depends on: every module checks the roles and permissions set here, every approval in every module (purchase requisitions and orders, sales orders, NCR dispositions, BOM releases, invoices, leave, and so on) is routed by the workflows set here, plants/departments/cost centers set here are picked on transactions everywhere, and the company details and Partners set here are used on generated letters and documents. Sign-in itself is Microsoft Entra ID (Azure AD) single sign-on; users, their department and office location are synced from Azure.

## 1. Navigation Tabs

The module sub-nav (OrganizationNav) sits at the top of every Organization page. A tab is shown only if the user holds the "view" permission on that tab (admins see every tab). "My Approvals" has no permission key and is shown to every signed-in user. A "guided tour" icon button sits at the right end of the nav.

| Tab | Route | What it opens |
|---|---|---|
| Info | /dashboard/organization/info | Company master: Basic, Address, Legal & Registration, Tax Configuration, Partners, Contacts, Financial Year, Branding, Documents, Defaults & Controls |
| Branches | /dashboard/organization/plants | List of plants/branches; add, view, edit, activate/deactivate, delete |
| Department | /dashboard/organization/department | Department list with heads and members |
| Users | /dashboard/organization/users | Read-only list of users with their modules and approval roles |
| Role & Permissions | /dashboard/organization/roles | Roles (named bundles of permissions), their data access and holders |
| Approval Workflows | /dashboard/organization/workflows | Every document type that needs approval, grouped by module, and its approval stages |
| Delegations | /dashboard/organization/delegations | Everyone's approval hand-overs (out-of-office) |
| Security & Sessions | /dashboard/organization/security | Session policy, live sessions with sign-out, sign-in activity |
| Audit Logs | /dashboard/organization/audit-logs | Read-only record of who did what and when, across all modules |

My Approvals is not an Organization tab: it has its own Sidebar entry (/dashboard/approvals, every signed-in user) with the user's approval inbox, submissions, decisions and own delegations. The old address /dashboard/organization/approvals redirects there.

Related screen outside the sub-nav: **Users & Roles** at /dashboard/users (list) and /dashboard/users/[ref] (one user). This is where a user's roles, approval flags, extra permissions, data access, plant assignments and documents are managed. It is reached by clicking a user's name on a role's Users tab, or directly by URL; its Back button returns to /dashboard/users. It uses the same "Users" tab permission.

## 2. Dashboard

The Organization module has no dashboard page. Opening /dashboard/organization (from the sidebar "Organization" link or the home page "Organization" card) immediately redirects the user to the first Organization tab they are allowed to view, in nav order (Info, Branches, Department, Users, Role & Permissions, Approval Workflows, Delegations, Security & Sessions, Audit Logs). A user who can view none of them is sent to the main dashboard.

The sidebar "Organization" link is shown to admins and to any user holding at least one "organization:<tab>:view" permission.

Summary statistics exist on two screens and are described with those screens: the Audit Logs stat cards (Total Logs, Today, Last 7 Days, Most Active User) and the Users & Roles stat cards (Total Users, Active, Inactive, Admins).

## 3. Screens

### Info (Company Info) — /dashboard/organization/info

The single company record ("Master information about this organization — used on letterheads, invoices, and other generated documents"). There is only ever one company row.

#### View page

**Header:** "Organization / Info". Button **Edit** (or **Set Up Company Info** when no company row exists yet) — shown only to users with Company Info "Edit"; opens /dashboard/organization/info/edit.

If the company has not been set up, the page shows "Company info hasn't been set up yet" instead of the tabs. Load errors show in an error dialog with a Reload button.

The view has ten inner tabs:

**Basic**

| Field | Meaning |
|---|---|
| Company Name | Trading name |
| Legal Name | Registered legal name |
| Short Name | Short form |
| Code | Company code (stored in capitals) |
| Company Type | e.g. Private Limited |
| Industry | Industry |
| Business Nature | Nature of business |
| Website | Website |
| Description | Free text |
| Date of Incorporation | Date |
| Country | Country |
| Default Currency | e.g. INR |
| Default Language | e.g. English |
| Time Zone | e.g. Asia/Kolkata |

**Address** — one card per company address: address type (or "Address"), PRIMARY badge, INACTIVE badge, and the joined address (line 1, line 2, landmark, city, district, state, country, PIN). "No addresses added yet." when empty.

**Legal & Registration**

| Field | Meaning |
|---|---|
| Legal Entity Type | e.g. Private Limited Company |
| Legal Status | e.g. Active |
| CIN | Corporate Identification Number |
| PAN | PAN |
| TAN | TAN |
| GSTIN | GST number |
| Udyam Registration No. | Udyam number |
| IEC | Import Export Code |
| MSME Registration No. | MSME number |
| PF Registration No. | Provident Fund number |
| ESIC Registration No. | ESIC number |
| Other Registration Type / Registration Number / Registration Date / Issuing Authority / Expiry Date | Any one additional registration |
| Authorized Capital | Number |
| Paid-up Capital | Number |
| Legal Representative | Name |

**Tax Configuration**

| Field | Meaning |
|---|---|
| GST Registration Type | e.g. Regular |
| TDS Applicable | Yes / No |
| TCS Applicable | Yes / No |
| Default Tax Region | Text |
| Tax Deductibility | Text |
| Tax Registration Status | e.g. Active |
| Tax Effective Date | Date |

**Partners** — the company's Partners: portal users who are the top approval level. Text on screen: Partners are "final approvers on legacy purchase orders, escalation contacts for overdue project WBS elements, and the default signatory on letters and certificates". Each partner shows name, PARTNER badge, INACTIVE badge if deactivated, designation and email. "No partners set yet." when empty.
- **Actions:** **Manage partners** (or **+ Add partners** when none) — shown to users with Company Info "Edit". Opens a user picker (users synced from Azure). A warning shows if the list is emptied ("With no partners, nobody can give the final approval on legacy purchase orders still waiting for a Partner"). **Cancel** and **Save partners**.
- **Rules (server):** every picked user must exist and be active (a deactivated user is refused with their name). A non-admin can never add or remove themselves as a Partner. Every change writes an audit entry "… added X and removed Y as partner". This is the only place the Partner flag is set; the user page shows it read-only.

**Contacts** — one card per contact: contact person, designation badge, PRIMARY / INACTIVE badges, then department · mobile · email.

**Financial Year** — one card per year: name, status badge (OPEN green / CLOSED red), start date → end date and fiscal year code.

**Branding**

| Field | Meaning |
|---|---|
| Company Logo | Logo URL |
| Primary Brand Color | Hex color with swatch |
| Secondary Brand Color | Hex color with swatch |
| Accent Color | Hex color with swatch |
| Company Header | Multi-line header text for documents |
| Company Footer | Multi-line footer text |
| Watermark | Text (e.g. DRAFT) or image URL |
| Email Signature | Multi-line signature |

**Documents** — one card per company document: document name, type badge, confidentiality badge, file name, expiry date, issuing authority, and an **Open** link (opens the file in SharePoint).

**Defaults & Controls**

| Field | Meaning |
|---|---|
| Default Tax | Text, e.g. GST 18% |
| Default Plant | Shown as "#" plus the plant's id |
| Default Store | Shown as "#" plus the store location id |
| Default Cost Center | Text |
| Default Profit Center | Text |

#### Edit — /dashboard/organization/info/edit

Opened by Edit / Set Up Company Info. Needs Company Info "Edit" (otherwise the user is sent to their first allowed Organization tab). Same inner tabs as the view except Partners (partners are managed on the view page). If the company does not exist yet, a note explains: fill at least Name and Code and save; Address, Contacts, Financial Year and Documents can only be added after that first save (those tabs show a "save first" message).

Single-record tabs (Basic, Legal & Registration, Tax Configuration, Branding, Defaults & Controls) share **Cancel** (back to Info) and **Save Changes** buttons at the bottom. Save creates the company (first time) or updates it, then returns to the Info page. List tabs (Address, Contacts, Financial Year, Documents) save each row on its own and have no page-level Save.

**Basic tab fields**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Company Name | text | Yes | Free text | Must not be blank (checked on screen and by the server) |
| Legal Name | text | Marked * | Free text | Not enforced |
| Short Name | text | No | Free text | |
| Code | text | Yes | Free text | Converted to capitals as you type; must not be blank |
| Company Type | text | No | Placeholder "Private Limited" | |
| Industry | text | No | | |
| Business Nature | text | No | | |
| Website | text | No | | |
| Description | text area | No | | |
| Date of Incorporation | date | No | | |
| Country | text | Marked * | | Not enforced |
| Default Currency | text | Marked * | Placeholder "INR" | Not enforced |
| Default Language | text | No | Placeholder "English" | |
| Time Zone | text | Marked * | Placeholder "Asia/Kolkata" | Not enforced |

**Legal & Registration tab fields** — all optional text unless stated: Legal Entity Type, Legal Status, CIN, PAN, TAN, GSTIN, Udyam Registration No., IEC, MSME Registration No., PF Registration No., ESIC Registration No., Other Registration Type, Registration Number, Registration Date (date), Issuing Authority, Expiry Date (date), Legal Representative, Authorized Capital (number), Paid-up Capital (number).

**Tax Configuration tab fields** — GST Registration Type (text, placeholder "Regular"), Default Tax Region (text), Tax Deductibility (text), Tax Registration Status (text), Tax Effective Date (date), TDS Applicable (checkbox), TCS Applicable (checkbox).

**Branding tab fields** — Company Logo URL (text), Primary / Secondary / Accent Brand Color (text hex, placeholders #FF7A45, #1F1108, #3B82F6), Company Header (text area), Company Footer (text area), Watermark (text, "e.g. DRAFT, or a watermark image URL"), Email Signature (text area).

**Defaults & Controls tab fields**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Default Tax | text | No | Placeholder "GST 18%" | |
| Default Plant | dropdown | No | All branches | |
| Default Store | dropdown | No | All store locations (Store module) | |
| Default Cost Center | text | No | | Free text |
| Default Profit Center | text | No | | Free text |

**Address tab (add / edit form plus list)**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Address Type | text | No | Placeholder "Registered Office" | |
| Landmark | text | No | | |
| Address Line 1 | text | Yes | | "Address Line 1 is required" |
| Address Line 2 | text | No | | |
| Country | text | No | | |
| State / UT | text | No | | |
| City | text | No | | |
| District | text | No | | |
| PIN Code | text | No | | |
| Primary | checkbox | No | | Ticking it clears Primary on every other company address |
| Active | checkbox | No | Default ticked | |

Buttons: **Save Address** (or **Save Changes** when editing), **Cancel edit**. Each listed address has **Edit** and **Delete** (Delete asks for confirmation; cannot be undone).

**Contacts tab** — fields: Contact Type (text, placeholder "Primary"), Contact Person (text, required — "Contact Person is required"), Designation, Department, Mobile, Phone, Email, Alternate Email, Communication Preference (text, placeholder "Email"), Primary (checkbox), Active (checkbox). Buttons **Save Contact** / **Save Changes**, per-row **Edit** and **Delete** (with confirmation).

**Financial Year tab**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Financial Year Name | text | Yes | Placeholder "FY 2025-26" | |
| Start Date | date | Yes | | |
| End Date | date | Yes | | Must be on or after the start date |
| Fiscal Year Code | text | No | | |
| Status | dropdown | No | Open, Closed | Default Open; any other value is refused ("use Open or Closed; to freeze books up to a date, set the Lock Date instead") |
| Lock Date | date | No | | Freezes books up to this date |
| Period Closing Rule | text | No | | |
| Reset number series | checkbox | No | | |

Server rules for financial years:
- Years may not overlap; the error names the clashing year and its dates.
- A year cannot be set to Open here if Accounts has posted a year-end closing entry for it (reopen from Accounts > Year-end close).
- A year with postings but no year-end closing entry cannot be set to Closed here (close it from Accounts > Year-end close).
- A Closed year cannot be deleted; a year with posted journal entries in its dates cannot be deleted (the error gives the count).

Buttons **Save Financial Year** / **Save Changes**, per-row **Edit** and **Delete** (with confirmation).

**Documents tab**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Document File | file | Yes | Uploaded to SharePoint (folder company-documents) | "Select a file to upload"; refused if SharePoint is not configured |
| Document Type | dropdown | Yes | License, Certificate, Registration, Agreement, Legal, Tax, Other | |
| Document Name | text | Yes | | "Document Name is required" |
| Document Number | text | No | | |
| Issue Date | date | No | | |
| Expiry Date | date | No | | |
| Issuing Authority | text | No | | |
| Confidentiality | dropdown | No | Public, Internal, Confidential | |
| Tags | text | No | Comma separated | Split into a list on save |
| Description | text | No | | |
| Remarks | text | No | | |

Button **Save Document** (shows "Uploading…"). Each listed document has **Open** (SharePoint link) and **Delete** (with confirmation). Documents cannot be edited, only re-uploaded.

#### Statuses & workflow

No approval workflow. Financial year status is Open or Closed (see rules above). All company-record edits are recorded automatically in the audit trail.

### Branches — /dashboard/organization/plants

Branches (also called plants or units in messages) are the company's locations. They are also created automatically when a user signs in or is synced from Azure with an office location that does not yet exist as a branch.

#### List view

Title "All Branches". A search box ("Search Branch…") filters on branch name, code, company, branch type, branch manager and industry/function.

| Column | What it shows |
|---|---|
| Branch Code | Code |
| Branch Name | Name |
| Company | Company name |
| Branch Type | e.g. Manufacturing |
| Branch Manager | Manager's name |
| Industry / Function | Text |
| Status | Colored badge: Active (green), Inactive (grey), Under Maintenance (amber), Under Construction (blue), Closed (red) |
| Created Date | Date created |
| Last Updated | Date last changed |
| (actions) | Row actions |

Clicking a row opens the branch view. **Top button:** **+ Add Branch** (needs Branches "Create").

**Row actions:**
- **View** — opens the branch view.
- **Edit** — opens the edit page (needs Branches "Edit").
- **Deactivate / Activate** — toggles status between Active and Inactive in one click (needs Branches "Edit").
- **Delete** — needs Branches "Delete" (and, for non-admins, having created the branch). A browser confirmation asks "Delete branch …? This cannot be undone." The server refuses the delete if anything uses the branch — users, departments, the company default-plant setting, cost centers, store locations, maintenance assets, production workstations/work orders, RRV builds, HR employee profiles/holidays/shifts/assets/visitors/lifecycle events, electrical jobs, hydraulic systems, sales orders, or any other table pointing at it — and lists the counts, advising "Set the plant to Inactive instead". When the delete is allowed, the branch's own addresses, user assignments, documents (also removed from SharePoint) and per-plant settings are deleted with it.

#### Create form — /dashboard/organization/plants/new

Title "Add Branch" with breadcrumb "Branches › New" and a **← Back** button. The tab bar shows all eight branch tabs but only Basic is usable; clicking another tab shows "Save this branch first — Address, Users, Stores, Cost Centers, and Documents can be added from the Edit page once the branch exists." Needs Branches "Create".

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Branch Name | text | Yes | Placeholder "Unit 3" | "Branch name is required" |
| Branch Code | text | Yes | Placeholder "Unit 3" | Must be unique ("Plant code '…' already exists") |
| Company | dropdown | Yes | The single company record | "Company is required" |
| Branch Type | text | Yes | Placeholder "Manufacturing" | "Branch type is required" |
| Branch Status | dropdown | Yes | Active, Inactive, Under Maintenance, Under Construction, Closed | Default Active |
| Branch Head | dropdown | No | User directory | |
| Branch Manager | dropdown | No | User directory | |
| Established Date | date | No | | |
| Industry / Function | text | No | | |
| Active From | date | No | | |
| Description | text area | No | | |
| Remarks | text area | No | | |

Buttons **Cancel** and **Save Branch**. After saving, the user lands on the new branch's Edit page.

#### View page — /dashboard/organization/plants/[ref]

**Header:** branch name, status badge, "Code: …". Buttons **← Back** (to the list) and **Edit** (needs Branches "Edit"). An edited or invalid link shows an "Invalid link" message with "Back to branches".

Eight tabs:

**Basic** — Company, Branch Type, Branch Head, Branch Manager, Established Date, Industry / Function, Active From, Description, Remarks.

**Address** — cards with address type, PRIMARY / INACTIVE badges and the joined address.

**Operational Configuration**

| Field | Meaning |
|---|---|
| Working Calendar | Text |
| Working Days | e.g. Mon–Fri |
| Working Hours | e.g. 09:00–18:00 |
| Time Zone | e.g. Asia/Kolkata |
| Default Store | Name of the default store location of this branch |
| Default Cost Center | Name of the default cost center |
| Default Profit Center | Text |
| Currency | e.g. INR |

**Branch Users** — users posted to this branch: name, role badge, PRIMARY badge (primary branch of that user), then designation · department · access level · employee ID.

**Branch Departments** — departments belonging to this branch (name, code, head names). Note "Managed from Organization > Department."

**Branch Stores** — store locations of this branch: name, DEFAULT badge if it is the branch's default store, then code · type · manager · status.

**Branch Cost Centers** — cost centers: name, DEFAULT badge, then code · type · department · head.

**Branch Documents** — documents: name, type badge, file name, expiry date, version (v…), **Open** link.

#### Edit — /dashboard/organization/plants/[ref]/edit

Needs Branches "Edit". Same eight tabs, all editable except Branch Departments (read-only list; "Departments are created and edited from Organization > Department").

**Basic** — Branch Name *, Branch Code * (converted to capitals; must stay unique), Branch Type *, Branch Status * (same five values), Branch Head, Branch Manager (user directory), Established Date, Industry / Function, Description, Active From, Remarks. Company is not shown on edit. Screen checks: name and code must not be blank. **Cancel** and **Save Changes** appear at the bottom on Basic and Operational Configuration.

**Operational Configuration** — Working Calendar (marked *, not enforced), Working Days (placeholder "Mon–Fri"), Working Hours ("09:00–18:00"), Time Zone ("Asia/Kolkata"), Default Store (dropdown of this branch's stores), Default Cost Center (dropdown of this branch's cost centers), Default Profit Center (text), Currency ("INR"). Note: stores and cost centers are created on their own tabs and then chosen as defaults here.

**Address** (add/edit form plus list):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Address Type | text | Marked * | Placeholder "Main Plant" | Only Address Line 1 is actually checked |
| Landmark | text | No | | |
| Address Line 1 | text | Yes | | "Address Line 1 is required" |
| Address Line 2 | text | No | | |
| Country | text | Marked * | | Not enforced |
| State / UT | text | Marked * | | Not enforced |
| City | text | Marked * | | Not enforced |
| District | text | No | | |
| PIN Code | text | Marked * | | Not enforced |
| Primary Address | checkbox | No | | |
| Active | checkbox | No | | |

Buttons **Save Address** / **Save Changes**, **Cancel edit**, per-row **Edit** / **Delete** (with confirmation).

**Branch Users** (user posting / assignment):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| User | dropdown | Yes | User directory | "User is required" |
| Employee ID | text | No | | |
| Department | dropdown | No | Departments of this branch | |
| Designation | text | No | | |
| Role | text | No | Free text label | Not a security role |
| Access Level | dropdown | No | View, Edit, Admin | |
| Effective From | date | No | | |
| Effective To | date | No | | |
| Status | dropdown | No | Active, Inactive | |
| Primary Branch for this user | checkbox | No | | Ticking it clears the primary flag on that user's other branch assignments |

Buttons **Save Branch User** / **Save Changes**, per-row **Edit** / **Remove** (with confirmation). Assignments are also maintained from the user's Assignments tab; either Branches "Edit" or Users "Edit" allows it. A user's branch assignments are what the "Multiple plants" data access level uses.

**Branch Stores** (creates Store module locations under this branch):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Store Name | text | Yes | | "Store Name and Code are required" |
| Store Code | text | Yes | | Converted to capitals |
| Store Type | text | Marked * | Placeholder "Raw Material" | |
| Store Manager | dropdown | No | User directory | |
| Address | text | No | | |
| Storage Type | text | No | | |
| Inventory Type | text | No | | |
| Operating Hours | text | No | Placeholder "09:00–18:00" | |
| Status | dropdown | Marked * | Active, Inactive, Under Maintenance | |

Buttons **Save Store** / **Save Changes**, per-row **Edit** / **Delete** (with confirmation; the Store module may refuse if the store is in use).

**Branch Cost Centers**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Cost Center Code | text | Yes | | Converted to capitals; must be unique |
| Cost Center Name | text | Yes | | |
| Cost Center Type | text | No | | |
| Department | dropdown | No | Departments of this branch | |
| Cost Center Head | dropdown | No | User directory | |
| Parent Cost Center | dropdown | No | Other cost centers of this branch, or None | |
| Effective From | date | No | | |
| Effective To | date | No | | |
| Status | dropdown | No | Active, Inactive | |

Buttons **Save Cost Center** / **Save Changes**, per-row **Edit** / **Delete**. The server refuses deleting a cost center that is a branch's default cost center or that other cost centers use as parent. Creating, editing and deleting cost centers needs Branches "Edit".

**Branch Documents**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Document File | file | Yes | Uploaded to SharePoint | "Select a file to upload" |
| Document Type | dropdown | Yes | License, Certificate, Registration, Agreement, Compliance, Other | |
| Document Name | text | Yes | | "Document Name is required" |
| Document Number | text | No | | |
| Issue Date | date | No | | |
| Expiry Date | date | No | | |
| Issuing Authority | text | No | | |
| Version | text | No | | |
| Status | text | No | Placeholder "Active" | |
| Confidentiality | dropdown | No | Public, Internal, Confidential | |
| Tags | text | No | Comma separated | |
| Remarks | text | No | | |

Button **Save Document**; per-row **Open** and **Delete** (with confirmation).

#### Statuses & workflow

Branch status: Active, Inactive, Under Maintenance, Under Construction, Closed. Any value can be chosen directly in the form; the list's Activate/Deactivate link switches between Active and Inactive. No approval. Edits are recorded in the audit trail automatically.

### Department — /dashboard/organization/department

Departments are created automatically from Azure sign-in and Azure sync (the user's free-text Azure department becomes a department under their branch; a new department's head is seeded from the user's Azure manager only when that manager is in the same branch; once any head exists, sync never changes heads). They can also be added manually here.

#### List view

| Column | What it shows |
|---|---|
| Name | Department name, with an expand arrow |
| Code | Department code (the full name; a number is added when the same name exists in another branch) |
| Branch | Branch name. Clicking the column header opens a filter list: All Branches or one branch |
| Head | All head names joined with " / " |

Empty state: "No departments yet — sign in or run Azure sync to populate this." **Top button:** **+ Add Department** (needs Department "Create").

**Expanding a row** (click it) shows the members as a tree: heads first in bold with a HEAD badge, then name · designation · email. Members are users whose department is this department.
- **Remove** next to a non-head member (needs Department "Edit") clears that user's department. Heads cannot be removed here.
- **+ Add member — search name or email…** (needs Department "Edit"): type to search the user directory (up to 8 matches), click a person to move them into this department; their branch is also set to the department's branch. Adding and removing members are written to the audit log.

#### Create form (Add Department pop-up)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Name | text | Yes | Placeholder "Accounts" | "Department name is required" |
| Branch | dropdown | No | All branches | Changing the branch drops already-picked heads who are not in the new branch |
| Head of Department (one or more) | multi-select chips with search | No | User directory, filtered to people posted in the selected branch | Server: every head must exist and belong to the department's branch, otherwise the error names who is not in that branch |

The first head picked is stored as the head, the second as secondary head, the rest as additional heads. Buttons **Cancel** and **Save Department**. The code is generated from the name automatically.

#### Edit

There is no edit form on this screen. The server supports editing (name, branch, heads) and deleting a department; deletion is refused while members still belong to it, while any head is set, or while other records use it (cost centers, plant user assignments, employee profiles, HR designations, lifecycle events, design documents, maintenance assets, production workstations, project WBS elements, material issues/returns, and so on).

#### Statuses & workflow

No statuses. Department heads are used by approval workflows ("Requester's department head" stages).

### Users — /dashboard/organization/users

A view-only list: "module access and approval roles are granted from Organization > Role & Permissions." Search box filters by name or email.

#### List view

| Column | What it shows |
|---|---|
| User | Name |
| Email | Email |
| Department | Department (from Azure) |
| Branch | Branch name |
| Role | "admin" or "user" |
| Modules | "All" for admins, "None" if no module, otherwise one badge per module the user can open |
| Approval Roles | Badges for each approval flag held: Partner, Director, Department Head, Plant Head, Project Head, Purchase Head, Finance Manager, Purchase Manager, Store Manager, Production Manager, Design Manager, R&D Manager, Project Manager |
| Status | Active / Inactive |

No row actions and no buttons.

### Users & Roles (user list) — /dashboard/users

Title "Users & Roles — Manage portal users, roles, and module access". Uses the Users tab permission. Has a guided-tour button and the feedback bell.

#### Dashboard cards

| Card | Value |
|---|---|
| Total Users | Count of users in the list |
| Active | Users with Active status |
| Inactive | Users with Inactive status |
| Admins | Users whose role is admin |

All counts are computed in the browser from the loaded user list.

#### List view

Status tabs: **All Users**, **Active Users**, **Inactive Users**. Search by name or email. **Sync from Azure AD** button (needs Users "Create") pulls every member of the Azure tenant into the users table (also creating/linking branches and departments) and refreshes the list; shared mailboxes and guests are filtered out.

| Column | What it shows |
|---|---|
| User | Initials avatar and name |
| Email | Email |
| Designation | From Azure |
| Department | From Azure |
| Office Location | From Azure |
| Role | admin / user |
| Apps | "All" for admins, "None", or one badge per module |
| Status | Active / Inactive |
| Actions | **Edit** (if the viewer has Users "Edit") or **View** — opens the user page |

Clicking a row also opens the user page.

### User page — /dashboard/users/[ref]

**Header:** user name, Active/Inactive badge, email. Buttons: guided tour, **← Back** (to /dashboard/users). Eight tabs (Roles & Permissions is hidden from viewers without Role & Permissions "View").

**User Details** — read-only: Full Name, Email, Designation, Department, Office Location, Branch, Reporting Manager, Phone, Role, Date of Joining. Note: name, email, designation, department and office location are synced from Azure AD and can't be edited here.
- **Deactivate User / Activate User** (needs Users "Edit"; disabled on your own account). Deactivating immediately signs the user out of every device and records an audit entry (which also stops Azure sync re-activating them). Activation is refused if the person was exited in HR ("complete a joining event in HR > Lifecycle"). Only an admin may change an admin account.

**Assignments** — the user's branch postings. Same fields as Branch Users above, except the first field is **Branch** (required, dropdown of all branches; locked while editing) and Department lists only that branch's departments. Checkbox "Primary Branch". Buttons **Save Assignment** / **Save Changes**, **Cancel edit**, per-row **Edit** / **Remove**. Form and row buttons appear only with Users "Edit" or Branches "Edit".

**Roles & Permissions** (needs Role & Permissions "View"). For an admin user it only says admins can do everything and roles don't apply. Otherwise four sections:
1. **Roles** — search box and a tick-box per assignable role (inactive roles hidden unless already held; built-in presets marked BUILT-IN). Text lists the "applies to everyone" roles every user gets automatically. Link **Manage roles →**. **Save Roles** (needs Role & Permissions "Edit"; enabled only when something changed). A non-admin cannot change their own roles, and cannot assign a role that grants permissions they do not hold themselves.
2. **Approval Roles** — who approvals are routed to (not permissions). Partner is shown read-only ("✓ Partner" / "Not a Partner") with a link "change in Company Info →". Tick-boxes with hover hints: Director, Department Head, Plant Head, Project Head, Purchase Head, Finance Manager, Purchase Manager, Store Manager, Production Manager, Design Manager, R&D Manager, Project Manager. **Save** needs Users "Edit"; nobody but an admin can change their own flags.
3. **Extra permissions (this user only)** — collapsed by default (Show / Hide). A Permission Matrix for one-off grants on top of roles; ticks that come from roles appear faded and locked, with the role names on hover. **Save Extra Permissions** needs Role & Permissions "Edit".
4. **Effective access** — read-only matrix of everything the user can do now (roles + extras), only modules with at least one grant, plus the list of modules they can open. Hovering a tick shows which role gives it.

**Data Access** — one row per module: module name, a dropdown (Follow roles, Own records, Own + assigned, Department, Plant / branch, Multiple plants, Entire organization) and "now: …" showing the effective level. A personal override beats every role. **Save data access** needs Role & Permissions "Edit"; applies on the user's next page load.

**Permission History** — list of permission changes for this user (summary or action, date/time).

**Login History** — "Login History · N live". One card per session: sign-in time, a badge if ended (SIGNED OUT, SIGNED OUT BY ADMIN, IDLE TIMEOUT, RENEWED, DEVICE LIMIT, DEACTIVATED, or REVOKED), last used, expiry, IP address, browser string. **Sign out everywhere** (needs Security & Sessions "Edit", shown when live sessions exist) ends every live session after confirmation.

**User Activity** — list of the user's recorded actions: action, entity type badge, summary and date/time.

**User Documents** — upload form (needs Users "Edit"):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Document File | file | Yes | Uploaded to SharePoint | "Select a file to upload" |
| Document Type | dropdown | Yes | ID Proof, Offer Letter, Certificate, Agreement, Other | Default Other |
| Document Name | text | Yes | | "Document Name is required" |
| Document Number | text | No | | |
| Issue Date | date | No | | |
| Expiry Date | date | No | | |
| Issuing Authority | text | No | | |
| Confidentiality | dropdown | No | Public, Internal, Confidential | Default Confidential |
| Tags | text | No | Comma separated | |
| Remarks | text | No | | |

Button **Save Document**. List rows show name, type, file name, expiry, **Open** link and **Delete** (Users "Edit", with confirmation).

### Role & Permissions (role list) — /dashboard/organization/roles

Explanation on screen: a role is a job's access — which modules, tabs and actions it allows; users get one or more roles and their access is everything their roles allow; users can delete only records they created themselves (admins can delete anything).

#### List view

Search box ("Search roles…") on name and description. Filter pills: **Custom roles** (default), **Built-in presets**, **All**.

| Column | What it shows |
|---|---|
| Role | Role name (inactive roles shown faded) |
| Description | Description |
| Type | Built-in or Custom badge; "Everyone" badge if it applies to all users; "Inactive" badge |
| Users | Number of holders, or "All" for an everyone role |

Clicking a row opens the role. **Top button:** **+ New Role** (opens /dashboard/organization/roles/new; the server requires Role & Permissions "Create" to save). Guided-tour button.

### Role page — /dashboard/organization/roles/[ref] (and /roles/new)

**Header:** role name (or "New Role"), "N permission(s) across M module(s) · held by K user(s)" or "· applies to everyone". Buttons: guided tour, **Copy** (existing roles), **Delete** (custom roles only), **← Back**. A built-in preset shows a blue note: it can be assigned but not changed; use Copy to make an editable role.

#### Create / edit form (top section)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Role name | text | Yes | Placeholder "e.g. Store Keeper" | At least 2 characters; must be unique (case-insensitive) |
| Description | text | No | | |
| Active | checkbox | No | Default on | An inactive role gives nobody anything |
| Applies to everyone | checkbox | No | | Every user gets the role without being assigned (e.g. Employee self-service) |

All fields are locked on built-in presets.

#### Tabs

**Permissions** — the Permission Matrix. A search box ("Search module or tab…"), **Expand all** / **Collapse all**. One card per module showing the module name and a count badge (No access, Full, or granted/total). Preset buttons per module: **No access**, **View only** (view every tab), **Contributor** (view, create, edit on every tab), **Full access** (every action on every tab, including approvals and settings). Expanded, the card is a table: one row per tab (grouped sub-tabs under a heading), one column per action (View, Create, Edit, Delete, Submit, Approve, Reject, Cancel, Export, Print, Import); a dash means that action doesn't exist on that tab. Ticking any action also ticks View; unticking View clears the row; clicking the tab name ticks/unticks the whole row. Presets save as module wildcards so they keep covering tabs added later. **Create Role** / **Save Role**.

**Data access** — one dropdown per module the role opens (Organization excluded): Own records, Own + assigned, Department, Plant / branch, Multiple plants, Entire organization. Choosing the server default removes the setting ("Not set = …"). On-screen rules: anyone always sees records they must approve; with several roles the widest access wins; a personal override on the user page beats all roles. **Create Role** / **Save Role**.

**Users** (disabled until the role is saved) — for an everyone role, a note only. Otherwise a search box "Add a user — type a name or email…", the list of holders (click a name to open the user page) with **Remove**, and **Save Users** (enabled when changed; needs Role & Permissions "Edit").

#### Statuses & workflow and server rules

- Saving shows "Role saved. Users holding it get the new access on their next page load."
- Unknown permission ids are refused. A non-admin cannot put into a role, or hand out a role with, any permission they do not hold themselves.
- Built-in presets cannot be edited or deleted.
- **Copy** asks for a new name and creates an editable copy (same permissions and data access), then opens it. Needs Role & Permissions "Create".
- **Delete** asks for confirmation. Refused while any user holds the role ("remove it from them first, or mark it inactive"). Needs Role & Permissions "Delete" and, for non-admins, having created the role.
- Every create, update, copy, delete and change of holders is written to the audit log (with before/after values).

### Approval Workflows (list) — /dashboard/organization/workflows

Explanation on screen: who approves each kind of document, in what order. The workflow decides who approves; the approver's role permissions decide whether they are allowed to. Changes apply to documents submitted after saving; documents already waiting keep their approvers.

#### List view

Search box. One card per module, listing each approval type that module has registered in code. Each row shows:
- the document type name and "<tab> tab";
- the stage chain, e.g. "Department head → Partner", or "Approval switched off — documents are approved on submit";
- a badge **Configured** (saved by an admin) or **Default** (running on the module's built-in default);
- **Edit** — opens the workflow editor.

Registered types include, for example: Purchase requisition, Purchase order (Procurement); Sales order, Sales order amendment (Sales); NCR disposition, Inspection plan, CAPA effectiveness (D8), Customer complaint close / reject, Vendor approval (Trial → Approved), Vendor block / unblock (Quality); BOM revision release, Drawing / document revision release, Engineering change notice without ECR (Design); Material return, Stock adjustment, Stock transfer (Store); Work order release, BOM activation, RRV sign-off (Production); Hydraulic / pneumatic circuit, Hydraulic BOM release, Hydraulic test result (Hydraulic); Electrical component selection, Electrical drawing revision (Electrical); Manual journal voucher, Purchase invoice, Sales invoice, Debit note, Credit note, Accounting period close, Depreciation run, Financial year close (Finance); New machine, Service request closure (Service); Maintenance work order close-out; WBS acceptance (Projects); Leave request (HR). The list on screen is always the live set from the code.

### Workflow editor — /dashboard/organization/workflows/[key]

**Header:** "<Module> › <Tab>", the document type name and its description. Buttons **Reset to default** (needs Approval Workflows "Edit"; confirmation: replaces the stages with the module's built-in default; waiting documents unaffected) and **← Back**. A user with only "View" sees everything read-only with the note "changing it needs Organization › Approval Workflows › Edit".

**Flow diagram** at the top: Submitted → each stage (number, name, who approves, "all must sign" or "any one signs", "When: …" conditions, escalation hours, "skippable") → Approved. If approval is off: Submitted → Approval off → Approved. Stages with problems are red with a "N to fix" badge; conditional stages are blue. Clicking a stage scrolls to it.

#### 1. General settings

| Setting | Type | Meaning |
|---|---|---|
| Approval required | checkbox | Off = documents are approved as soon as they are submitted |
| Requester may approve own document | checkbox | Off = four-eyes: the requester is never their own approver (recommended off) |
| Different person per stage | checkbox | One person can approve only one stage of the same document |
| Approver also needs the Approve permission | checkbox | On = the resolved approver must also hold <module>:<tab>:approve (or reject for reject/return) |

A note links to Organization › Delegations for approvers going on leave.

#### 2. Approval stages

Each stage card has **↑ Up**, **↓ Down**, **Remove**, and these fields:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Stage name | text | Yes | e.g. "Department head" | |
| Approver | dropdown | Yes | Requester's reporting manager; Requester's department head; Plant head (the record's plant, else the requester's); Any company Partner; Any Director; Users with an approval flag; Specific users; Holders of a role; Holders of a permission; Person named on the record | |
| When several people match | dropdown | Yes | Any one of them approves; Every one must approve | |
| Users | multi-select | When Approver = Specific users | User directory | |
| Role | dropdown | When Approver = Holders of a role | Active roles | |
| Permission | dropdown | When Approver = Holders of a permission | Every approve/reject permission in the registry | |
| Approval flag | dropdown | When Approver = Users with an approval flag | Department head, Project head, Plant head, Purchase head, Director, Partner, Design manager, R&D manager, Production manager, Project manager, Store manager, Purchase manager, Finance manager | |
| Person on the document | dropdown | When Approver = Person named on the record | The document's user fields | "This document names no people" if none |
| Also allow holders of (optional) | dropdown | No | Nobody else, or an approve/reject permission | Holders may also decide this stage |
| Same plant only | checkbox | No | | Keep only approvers whose plant is the document's plant |
| Applies when (conditions) | rows of field / operator / value, joined by AND | No | Fields come from the document type; operators =, ≠, >, ≥, <, ≤, is one of, is not one of, is yes, is no (number operators only for numbers, yes/no only for yes/no fields); value is a dropdown when the field has fixed choices | No condition = "Always" |
| Skip this stage if nobody matches | checkbox | No | | Off (recommended) = submission is refused with the reason. A document is never approved with every stage skipped |
| Escalate after (hours) | number | No | Empty = off | 1–1440 hours |
| Escalate to | dropdown | When hours set | The late approver's reporting manager; Requester's department head; Any company Partner; Any Director; Specific users | Specific users needs "Escalation users" picked |

**+ Add stage** adds a blank stage. With no stages a red note says to switch "Approval required" off instead; the server refuses saving an active workflow with no stages.

#### 3. Check & preview

**Setup check** runs automatically about a second after every edit, against every active user who can raise this document ("Checked against N people"). Results:
- **Must fix** (red) — some people's documents would be refused because nobody can approve a stage for them (names and reason), or the requester is the only approver of a stage for their own documents.
- **Weak control** (amber) — approval switched off, self-approval allowed, a stage skipped for some people, more than 3 people who must all approve, every stage conditional.
- **Suggestion** (blue) — no escalation on a stage, "every Partner/Director must approve", different person per stage not switched on, every stage skippable.
Each issue tied to a stage has **Go to stage**. "✓ No problems" when clean.

**Try it** — pick a Requester and fill the document's other fields, then **Preview**: shows for the saved workflow, stage by stage, the approvers who would get it ("any one"/"all"), "skipped: reason", or "submission would be refused: reason"; or "No stage applies — the document would be approved on submit".

#### 4. Save & history

**Show change history** lists who changed the workflow and when, with a summary ("Not changed since it was set up" if never saved). **Save workflow** (shows "(N to fix)" when the check found errors; then a confirmation "Save with problems?" offers **Save anyway**). Saved message: applies to documents submitted from now on.

#### Statuses & workflow (the approval engine)

- When a module submits a record, the engine checks no approval is already pending for it, works out which stages apply (conditions) and who approves each (rules, Same plant, Also allow, four-eyes exclusions). If any non-skippable stage has nobody, submission is refused with the stage name and reason. If the workflow is off or no stage applies, the record is approved immediately.
- Request statuses: pending (Waiting), approved, rejected, returned (Returned for changes), cancelled. Step statuses: waiting (Not yet), pending (Waiting), approved, rejected, returned, skipped (Not needed), cancelled.
- Stages run in order. "Any one" mode: the first approval closes the stage. "All" mode: every approver must approve. Reject or Return ends the request at once (a comment is required). Some document types also require a comment on approval.
- Who may decide: the step's approver, an active delegate of that approver, an escalation target after escalation, holders of the "Also allow" permission, or an admin standing in (comment required). Four-eyes and "different person per stage" apply to admins too. When "Approver also needs the Approve permission" is on, non-admin deciders also need the tab's approve/reject permission.
- Withdraw (cancel): by the requester, an admin, or anyone with the tab's Cancel permission; modules also cancel automatically when the record is deleted/cancelled.
- Escalation: a scheduled job runs every hour (at minute 5) and escalates every pending step past its "escalate after" time once, to the configured targets.
- Every submission, decision, cancellation and escalation is written to the audit log; decisions made by a delegate, escalation target or admin record "on behalf of" the original approver.

### Delegations — /dashboard/organization/delegations

Explanation: while a delegation is active, the delegate can decide every approval addressed to the person who is away (all modules, one module, or one document type); decisions show "as delegate" in the approval history. Users manage their own under My Approvals; this tab lets an authorised person set one up for someone else.

#### Create form (New delegation) — needs Delegations "Create"

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Whose approvals | single user picker | Yes | User directory, placeholder "Person going away…" | "Pick whose approvals are being delegated." |
| Approved by (delegate) | single user picker | Yes | User directory, placeholder "Stand-in…" | Must be an active user and not the same person |
| From | date | Yes | Default today | |
| To | date | Yes | Default today | Must not be before From |
| For | dropdown | No | All approvals; "<Module> — all" per module; "<Module> — <document type>" per approval type | |
| Reason | text | No | Placeholder "e.g. On leave" | |

Button **Add delegation**. Server also refuses two people delegating to each other for overlapping dates.

#### List view

Checkbox **Show ended** (ended delegations hidden by default).

| Column | What it shows |
|---|---|
| Away | Person whose approvals are delegated |
| Delegate | Stand-in |
| From | Start date |
| To | End date |
| For | Document type, "<Module> (all)", or "All approvals" |
| Reason | Reason |
| Status | active (green), upcoming (blue), ended (grey) |
| (action) | **End now** — shown when not ended and the viewer has Delegations "Edit" |

#### Statuses & workflow

Status is computed: upcoming (start date in the future), active (today within the dates), ended (end date passed or ended manually). End now sets it ended; allowed for the delegator, the person who created it, or Delegations "Edit". Creating and ending are audited.

### Security & Sessions — /dashboard/organization/security

An information box explains that sign-in uses Microsoft Entra ID; multi-factor authentication, password rules and lockout are set in the Entra admin center, not here; disabling a user in Entra or deactivating them in the portal blocks sign-in.

#### Session policy (settings)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Access token (minutes) | number | Yes | Default from server config | 5–120. How long a page session is trusted before it silently renews |
| Stay signed in (days) | number | Yes | Default from server config | 1–30. After this the user must sign in with Microsoft again |
| Idle sign-out (minutes) | number | Yes | Default 0 | 0 = off, up to 10080 (7 days) |
| Devices per user | number | Yes | Default 0 | 0 = unlimited, up to 20. Signing in on one more device signs out the oldest |

Each field shows its default. **Save policy** (needs Security & Sessions "Edit"); changes apply from each user's next sign-in or token refresh and are audited with old → new values.

#### Signed-in sessions

Table of live sessions (not revoked, not expired; up to 500): User (name and email), Device (browser on operating system), IP address, Signed in / renewed, Expires. Actions (needs Security & Sessions "Edit"): **Sign out** (that one device, after confirmation) and **Everywhere** (every session of that user, after confirmation). Both are audited.

#### Sign-in activity

Table of the latest 200 sign-in events: When, Event (Signed in, Blocked, Signed out, Signed out by admin), Details, IP address, Device. Toggle button **Show blocked only** / **Showing blocked only**.

### Audit Logs — /dashboard/organization/audit-logs

"A read-only record of who did what, when — system-generated on every tracked action. Nothing here can be added or edited manually."

#### Dashboard cards

| Card | Value |
|---|---|
| Total Logs | Count of all audit entries |
| Today | Entries since midnight (server time, UTC) |
| Last 7 Days | Entries in the last 7 days |
| Most Active User (7d) | User with the most entries in the last 7 days, and their action count |

**Activity by Module** — one pill per module with its entry count (module taken from the entry, or inferred from the record type).

#### List view

Filters: Module (All Modules, Organization, Service Module, CRM Module, Procurement, Quality, Store, Production, Hydraulic & Pneumatic, Design, R&D, Other), Action (create, created, update, updated, delete, deleted, restored, approve, approved, reject, rejected, status_change, line_added, item_added, item_removed, member_added, member_removed), and a text search on the summary with a **Search** button. The latest 200 matching entries are shown, newest first.

Each entry card shows: #id, action, module badge, record type and id, date/time, summary and "by <user>", a **Changes** section (field, before, after — open by default when 3 or fewer fields changed; for a delete, "Record as it was before deletion"), and IP Address, Device / Browser, Session ID, and API / Application Source (Web App, or API Client (Bearer Token)).

### My Approvals — /dashboard/approvals

Open to every signed-in user. Four tab buttons:

| Tab | What it lists |
|---|---|
| Waiting for me | Every pending request the user can act on now — as approver, delegate or escalation target (count shown) |
| My submissions | The user's own submitted requests (latest 100) |
| Decided by me | Requests the user decided (latest 100) |
| My delegations | Delegations where the user is the delegator or the delegate |

Each request row shows: reference — title; document type · from requester · submitted date · amount in rupees (if any) · "on behalf of …" (when acting as delegate/escalation); status badge (Waiting, Approved, Rejected, Returned, Cancelled); **Open document** (goes to the record in its module); **Decide** (inbox) or **Details**, which expands the approval panel.

The approval panel shows the request status, every stage step with its status (Not yet, Waiting, Approved, Rejected, Returned, Not needed, Cancelled), escalation due time and comments, and the history of earlier requests. When the user can act: a comment box ("Comment (required to reject or return)") and buttons **Approve**, **Return for changes**, **Reject**. An admin who is not the approver sees a note that they can stand in with a comment. The requester (or a user with Cancel) sees **Withdraw approval request** with confirmation.

**My delegations** tab: the same New delegation form without the "Whose approvals" field (the user delegates their own approvals), with the note that the delegate still needs the module's Approve permission where the workflow requires it. Below, each delegation: "You → X" or "X → you", dates, scope, reason, state, and **End now** for the user's own active/upcoming delegations.

## 4. Settings / Masters

| Setting / master | Where | What it controls |
|---|---|---|
| Company master | Info | Company name, code, registrations, tax flags, branding (header, footer, watermark, colors, logo, email signature) used on generated documents; defaults (tax, plant, store, cost/profit center) |
| Partners | Info › Partners | Top approval level: the "Any company Partner" approver and escalation rule, legacy PO final approval, project escalation, default signatory |
| Financial years | Info › Financial Year | The company's financial years, open/closed status (kept consistent with Accounts year-end close), lock date |
| Branch / plant master | Branches | Plants, their addresses, operational calendar, default store and cost center, user postings (used by "Plant" and "Multiple plants" data access and "Same plant only" approvals), documents |
| Store locations | Branches › Branch Stores | Store module locations under each plant |
| Cost centers | Branches › Branch Cost Centers | Cost centers per plant (also visible to Finance) |
| Departments | Department | Departments, heads (used by "department head" approval stages and "Department" data access) and members |
| Roles | Role & Permissions | Permission Matrix grants and data access per module, and holders |
| Approval flags | User page › Roles & Permissions | Which users are Director, Department Head, Finance Manager, etc. for flag-based approval stages |
| Approval workflows | Approval Workflows | Stages, approvers, conditions, escalation and controls for every approval type in every module |
| Delegations | Delegations, My Approvals | Temporary approval hand-overs |
| Session policy | Security & Sessions | Token lifetime, stay-signed-in days, idle sign-out, devices per user |
| Default data scope | Server setting (DEFAULT_DATA_SCOPE) | Data access for modules a role does not set; falls back to "Own + assigned" |

## 5. Permissions

Permission ids have the form organization:<tab>:<action>. Admins (role "admin", or Azure tenant Global Administrators, who are made admin automatically at sign-in) pass every check. Everyone else is denied unless a role or an extra grant gives the permission. Any action on a tab implies View.

| Tab key | Tab | Actions available | What they unlock |
|---|---|---|---|
| info | Company Info | view, edit | View company info, partners, addresses, contacts, FYs, documents / edit all of them and manage partners |
| branches | Branches | view, create, edit, delete | View branches / add a branch / edit branch, addresses, stores, cost centers, documents, user postings, activate/deactivate / delete (own records only unless admin) |
| department | Department | view, create, edit, delete | View / add department / add or remove members and edit / delete (own records only unless admin) |
| users | Users | view, create, edit | View users and user pages / Sync from Azure AD / activate, deactivate, approval flags, user documents, plant assignments |
| roles | Role & Permissions | view, create, edit, delete | View roles, catalog, a user's effective permissions and data access / create and copy roles / edit roles, holders, a user's roles, extra permissions and data access / delete roles |
| workflows | Approval Workflows | view, edit | View workflows, check and preview / save and reset workflows |
| delegations | Delegations | view, create, edit, delete | See everyone's delegations / create one for someone else / end anyone's delegation |
| security | Security & Sessions | view, edit | View policy, sessions, sign-ins / save policy, sign users out (also "Sign out everywhere" on the user page) |
| audit_logs | Audit Logs | view | View audit logs and stats |

Additional rules:
- Organization is not a portal "app": the sidebar link appears for anyone with any organization view permission.
- The branch list is also readable by Users viewers and Store users (pickers); the department list by Branches viewers, Users viewers and Store users; cost centers by Branches viewers and Finance users.
- Plant user assignments: Branches or Users permission (view/edit) either works.
- Only an admin can make someone admin, remove admin rights, or change an admin's account. Nobody can deactivate themselves or change their own admin role.
- A non-admin cannot change their own roles, extra permissions or approval flags, and cannot grant (in a role, to a user, or by assigning a role) any permission they do not hold themselves.
- A non-admin with Company Info "Edit" cannot add or remove themselves as Partner.
- Delete anywhere in this module follows the company rule: Delete permission and the record was created by you (admins excepted).
- My Approvals and one's own delegations need no permission.
- Data scope levels (per module, per role, with a per-user override): Own records, Own + assigned, Department, Plant / branch, Multiple plants, Entire organization; the widest across roles wins; approvers always see records they must approve.

## 6. Documents, Notifications & Integrations

**Documents:** this module generates no Word or PDF documents. Company, branch and user documents are uploaded files stored in SharePoint (opened through the Open link); upload is refused if SharePoint is not configured. Company branding, registrations and Partners set here are used by other modules when they generate letters, invoices and certificates.

**Notifications (from the approval engine):**
- When a stage becomes active: "Approval needed: <title>" to each approver and their active delegates — bell notification and Microsoft Teams.
- When a step is escalated: "Escalated: <title>" to the escalation targets and "Overdue approval: <title>" to the late approver — bell and Teams.
- When approvals are handed over (for example on an HR exit): "Approval needed" to the new approver — bell and Teams.
- When a request finishes (approved, rejected, returned, cancelled) by someone other than the requester: "<reference> <outcome>" to the requester — bell only.
- No emails are sent by this module.

**Audit:** company/branch/department edits are audited automatically; partners, roles (with before/after), role holders, user changes, activation/deactivation, department membership, delegations, security settings, session sign-outs, sign-ins and blocked sign-ins, workflow saves and every approval action are written to the audit log shown on Audit Logs.

**Integrations and links to other modules:**
- Microsoft Entra ID (Azure AD): single sign-on; nightly and manual "Sync from Azure AD" create/update users, branches (from office location), departments (from department) and first branch assignments; Global Administrators become portal admins; deactivated users are not re-activated by sync.
- HR: an HR employee profile with locked organisation fields owns the user's plant and department (Azure sync does not overwrite them); users exited in HR cannot be re-activated here.
- Accounts / Finance: financial year open/closed status must agree with Accounts year-end close; cost centers are shared with Finance.
- Store: store locations are created under branches here; branch and department lists feed Store pickers.
- Every module: permission checks (Permission Matrix), data scope, and approval routing for all registered approval types (Procurement, Sales, Quality, Design, Store, Production, Hydraulic, Electrical, Finance, Service, Maintenance, Projects, HR).
- My Approvals "Open document" links to the record's page in its own module.
