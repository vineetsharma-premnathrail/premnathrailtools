# Premnathrail Portal — User Manual

**Module:** User & Admin Documentation
**Audience:** All portal staff (day-to-day users)
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This manual is a task-oriented guide to using the Premnathrail Portal in day-to-day work. It covers signing in, navigating the Dashboard, and using each business module available to you.

If a module does not appear in your sidebar, this is generally an access setting rather than a bug. See `faq.md`.

For server errors or pages that will not load, see `docs/09-operations/`.

---

# 2. Signing In

The portal uses **Microsoft sign-in only**. There is no separate portal username or password.

1. Open the portal login page and select the sign-in button.
2. Sign in with your company Microsoft account.
3. You are redirected to the portal Dashboard.

**Inside Microsoft Teams:** the portal first attempts silent SSO using your existing Teams session. If that fails, a **“Sign-in required — tap below to continue”** prompt appears and opens a sign-in popup.

### Common Sign-In Messages

| Message                                                                    | Meaning                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| “Your Microsoft account's email domain is not authorized for this portal.” | Your account is outside the configured company domain. |
| “Your account has been deactivated. Contact an administrator.”             | An administrator has deactivated your account.         |

Your first sign-in automatically creates your portal account from your Microsoft profile. An administrator must then assign the modules you need.

---

# 3. Dashboard

After signing in, you land on `/dashboard`.

The modules displayed in the sidebar depend on your assigned application access. Administrators automatically see every module.

Two navigation items are always available:

* **Updates** — displays recent portal changes.
* **Feedback** — sends an issue or suggestion to the admin team.

---

# 4. Service Module (ERP)

**Nav path:** Service Module → `/dashboard/erp`

The ERP Service Module manages projects, service requests, materials, attachments, and warranty information.

### Projects

Open the Projects list and select a project to view its details.

Required permissions:

* `project_create`
* `project_edit`
* `project_delete`

### Service Requests

Open **Service Module → Service Requests**.

Required permissions:

* `sr_create`
* `sr_edit`
* `sr_delete`

### Materials

Open a Service Request → **Materials**.

Material photos can be attached here and later viewed from the linked Purchase Requisition.

### Attachments & Warranty

Project and Service Request detail pages contain dedicated attachment and warranty sections.

Attachments are accessed through the backend, so authorization is checked before documents can be viewed or downloaded.

---

# 5. CRM

**Nav path:** CRM Module → `/dashboard/crm`

CRM covers the business-development pipeline: organizations and contacts, inquiries and tenders, the quotations sent against them, and the day-to-day activities (calls, meetings, site visits) a BD user logs while chasing that work. Anyone with CRM access can create and view records; editing and deleting a record is limited to its creator or an admin.

The module has three top-level tabs: **Dashboard**, **Organizations**, and **Inquiries & Tenders**. There is no separate Tenders tab — tenders live inside the combined Inquiries & Tenders list and open the same detail view as an inquiry.

### Dashboard

`/dashboard/crm` shows stat cards for total Organizations, Inquiries, Tenders, Open Follow-ups, Overdue Follow-ups, Today's Follow-ups, and Pending Tenders (click a card to jump to the matching filtered list), three "Recent" panels (Organizations, Inquiries, Tenders) with a **View all →** link into each list, and a Recent Follow Ups panel. It's a read-only summary — records are created from the Organizations or Inquiries & Tenders tabs, not from here.

### Organizations & Contacts

The Organizations list shows **+ Add Organization**, a single search box (name, type, zone, city, state), and a sortable/filterable table (Name, Type, Railway Zone, City, State, Created Date, Created By). Click a row to open its detail panel.

Creating an organization (`+ Add Organization`) captures name, type (Railway/Government/PSU/Private, or a custom "Other" type — picking a railway/government type also asks for Railway Zone and Division/Workshop), address and location fields, official phone/email, website, and GST number. Entering a GST number and clicking **Auto-fill** looks up the GSTIN and fills in the registered name, address, city, state, PIN, and country automatically. Contact Persons can be added as repeatable rows (Name, Designation, Department, Mobile, Email) directly on this form, or later from the detail panel.

The detail panel has tabs:

* **Overview** — organization, location, and registration details.
* **Contacts** — add contacts inline; each contact card shows the Inquiries/Tenders it's linked to.
* **Inquiries** — add an inquiry for this organization inline and see all of its inquiries with status, priority, and follow-up date.
* **Tenders** — add a tender for this organization inline and see all of its tenders with status and submission date.
* **Audit Trail** — a chronological log of changes to the record.

**Edit** is available to the creator or an admin; **Delete** (admin only) asks for confirmation and also removes the organization's inquiries and tenders.

### Inquiries & Tenders

This single list (with **+ New Record**) covers both record types, distinguished by a Type column (filterable to Inquiry or Tender), alongside ID, Organization, Stage, Status, Value/Priority, Created Date, and Created By — all searchable and most columns filterable or sortable. A new tender is normally created from an organization's Tenders tab rather than this list's own "+ New Record" button, which creates an inquiry.

Opening a record shows its universal ID (`INQ-YYYYMMDD-####` or `TND-YYYYMMDD-####`), status, priority, and a clickable **stage progress bar** — click any stage to jump the record to it (with confirmation), which logs a timeline entry and, for inquiries, sends a notification. From here you can also **Edit**, **Delete** (admin), and **Send Technical Offer Request to R&D** (see below).

Tabs on an inquiry:

* **Info** — organization, lead info, and product requirement (with a revision selector if the requirement has been changed since creation).
* **Quotations** — create and revise quotations (see below).
* **Documents** — Client Documents and Internal Documents folders, each with a category and multi-file upload.
* **Follow Ups** — add and manage Activities (see below) and export Minutes of Meeting.
* **Timeline** — a merged feed of audit, stage-change, revision, follow-up, and quotation history.

Tabs on a tender are similar, with **Dates** (publication, document download, pre-bid meeting, query submission, submission, technical/financial opening, expected award) replacing Quotations, and a Result section (Awarded To, LOI Number, Contract Value, or Loss Reason) once the tender is marked Won or Lost. A tender's Follow Ups tab is currently view-only.

### Quotations

From an inquiry's Quotations tab, **+ Create Quote** builds a commercial offer: quotation type (Domestic/Export), GST type, client details, and repeatable line items — pick an existing Product or type a new one to create it on the fly. Quantity, price, and GST% auto-calculate each line's subtotal and the grand total; discounts, delivery time, quote validity, quote conditions, and payment terms (again pick-or-create) round out the offer. Saved quotes can be downloaded as a PDF (with customer/GST details, letterhead, signature, and linked Technical Offer information) or **Revised** — a revision only changes price, payment terms, delivery time, or validity, and is tracked as its own version. Each quote also carries a Customer Response status you can update as the customer replies.

### Activities and Follow-Ups

From an Inquiry, Tender, or Organization's Follow Ups/Activities area, **+ Add Follow Up** (or **New Activity**) records a call, meeting, or site visit. Activities support a searchable Inquiry/Tender link, photo attachments (camera capture or drag-and-drop upload), and a follow-up date. Set a follow-up date and leave the activity Open, and the system will notify the owner one day before and on the day itself.

### Minutes of Meeting

From an Inquiry's Follow Ups tab, use **Export MoM** on an activity to generate a Minutes-of-Meeting document as Word (`.docx`) or PDF, with the Responsibility field showing the BD Owner.

### Technical Offer Requests

From an Inquiry or Tender's header, **Send Technical Offer Request to R&D** opens a dialog to optionally attach uploaded Client Documents and emails the request to R&D. The button greys out after sending until the record is edited again. Recipients — including external vendors with no portal account — get a link to a standalone Technical Offer Request page with an embedded PDF viewer and a Download option; the link is signed and time-limited rather than a raw SharePoint URL, so it can be shared safely with people outside the organization.

### Payment Terms and Products

`/dashboard/crm/payment-terms` and `/dashboard/crm/products` are simple reference lists (**+ Add Payment Term** / **+ Add Product**, with Edit/Delete per row) that back the pick-or-create fields on the Quotation form — the same lists can also be extended directly while building a quote.

---

# 6. R&D Tools

**Nav path:** R&D Tools → `/dashboard/rnd`

Available tools:

| Calculator          | Path                                 |
| ------------------- | ------------------------------------ |
| Braking             | `/dashboard/rnd/braking`             |
| Hydraulic           | `/dashboard/rnd/hydraulic`           |
| Load Distribution   | `/dashboard/rnd/load-distribution`   |
| Qmax                | `/dashboard/rnd/qmax`                |
| Spline              | `/dashboard/rnd/spline`              |
| Tractive Effort     | `/dashboard/rnd/tractive-effort`     |
| Vehicle Performance | `/dashboard/rnd/vehicle-performance` |
| Calculation History | `/dashboard/rnd/history`             |

Open a calculator, enter the required parameters, and submit.

Results and supported PDF/report exports are generated from the calculator page. Previous calculations are retained under **History**.

---

# 7. Purchase — Service-Linked Purchase Requisitions

**Nav path:** Purchase → `/dashboard/purchase`

This module handles procurement originating from ERP Service Request materials.

Workflow:

**Service Request Materials → Purchase Requisition → RFQ → Orders → GRN → Invoices → Vendors**

Purchase Requisition materials support remarks and viewing of photos uploaded through the Service Request.

Requisition status can be manually overridden when required, and materials are automatically marked **issued** after full receipt.

The Purchase module also provides the Purchase team's view of standalone P2P requests at:

`/dashboard/purchase/pr-requests`

---

# 8. P2P — Standalone Purchase Requisition

**Nav path:** P2P → `/dashboard/p2p`

P2P is separate from the Service-linked Purchase workflow.

It allows departments to raise Purchase Requisitions directly without creating an ERP Service Request.

### Raise a Requisition

Open:

`/dashboard/p2p/new`

Enter:

* Items
* Category
* Priority
* Required-by date
* Reason

Department Head, Project Head, and Plant Head can be selected where applicable.

### Approval Routing

Requests can pass through:

**Department Head → Project Head → Plant Head**

After RFQ processing, the resulting Purchase Order additionally requires the applicable:

**Purchase Head → Director → MD**

### Track Requisitions

Open `/dashboard/p2p` to view submitted requisitions.

The Purchase team reviews these submissions from:

`/dashboard/purchase/pr-requests`

You do not need Purchase module access to raise or track your own P2P requisition.

---

# 9. Store

**Nav path:** Store → `/dashboard/store`

The Store module manages inventory across physical locations.

### Stock Items

Browse the item catalog and view stock balances and movement history.

### Locations

Manage storage locations at:

`/dashboard/store/locations`

### Transactions

Record and review stock movements at:

`/dashboard/store/transactions`

### Cycle Count

Reconcile system stock against physical inventory at:

`/dashboard/store/cycle-count`

### New Stock Item

Create a new catalog item at:

`/dashboard/store/new`

---

# 10. HR

**Nav path:** HR → `/dashboard/hr`

HR provides an employee directory and organizational structure. It is not a payroll or attendance system.

### Employee Directory

`/dashboard/hr` displays active employees, reporting managers, and joining dates.

### Employee Profile

Users with HR access can edit:

* Reporting manager
* Date of joining
* Designation
* Department

### Organization Chart

View reporting relationships at:

`/dashboard/hr/org-chart`

---

# 11. Vendors

Vendor records are managed through the **Purchase** module rather than a separately assignable Vendor module.

Open:

`/dashboard/purchase/vendors`

Purchase module access is required.

---

# 12. Users & Roles

**Admin only**

**Nav path:** Users & Roles → `/dashboard/users`

Regular users do not see this navigation item.

Administrator account management, module assignment, and permission management are documented separately in `admin-manual.md`.

---

# 13. Getting Help

For access-related questions, see `faq.md`.

For administrator tasks, see `admin-manual.md`.

For operational or server problems, see `docs/09-operations/`.

For recent portal changes, use **Updates** in the navigation or review the release documentation.
