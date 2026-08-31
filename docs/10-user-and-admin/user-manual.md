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

CRM manages organizations, contacts, inquiries, tenders, activities, quotations, and technical offers.

### Organizations & Contacts

Organizations can be added or edited from the Organizations page and from other CRM pages.

### Inquiries & Tenders

Both provide Activities functionality for recording calls, meetings, notes, and related information.

### Activities

Open an Inquiry, Tender, or Organization → **Activities → New Activity**.

Activities support:

* Searchable Inquiry/Tender selection
* Photo attachments
* Camera capture
* Drag-and-drop uploads
* Minutes of Meeting items
* Contact linking

### Minutes of Meeting

From an Inquiry's Activities tab, use **Export MOM** to generate:

* Word (`.docx`)
* PDF

The Responsibility field displays the BD Owner.

### Quotations

Quotations automatically calculate line-item subtotals, taxable values, GST, and totals.

The generated PDF includes customer information, GST information, letterhead, signature details, and applicable Technical Offer information.

### Technical Offers

Technical Offer Requests can be generated as Word or PDF documents.

External recipients can receive a signed, time-limited document link without receiving a direct SharePoint URL.

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

# 11. Design

**Nav path:** Design → `/dashboard/design`

The Design module manages engineering documents and drawings associated with projects.

### Document List

Documents can be filtered by:

* Project
* Engineering discipline
* Document type
* Latest version

### Upload

Documents are uploaded, versioned, tagged, and stored through SharePoint integration.

### Document Detail

Open `/dashboard/design/[id]` to view document information and update its status.

---

# 12. Electrical

**Nav path:** Electrical → `/dashboard/electrical`

The Electrical module manages project-related electrical work orders.

### Work Orders

The main page lists work orders with status and priority.

### Create Work Order

Open:

`/dashboard/electrical/new`

Create a work order against a project. Work orders are automatically numbered, for example:

`EWO-2026-0001`

### Work Order Detail

Open:

`/dashboard/electrical/[id]`

From there, users can assign the work order and update its status and priority.

---

# 13. Vendors

Vendor records are managed through the **Purchase** module rather than a separately assignable Vendor module.

Open:

`/dashboard/purchase/vendors`

Purchase module access is required.

---

# 14. Users & Roles

**Admin only**

**Nav path:** Users & Roles → `/dashboard/users`

Regular users do not see this navigation item.

Administrator account management, module assignment, and permission management are documented separately in `admin-manual.md`.

---

# 15. Getting Help

For access-related questions, see `faq.md`.

For administrator tasks, see `admin-manual.md`.

For operational or server problems, see `docs/09-operations/`.

For recent portal changes, use **Updates** in the navigation or review the release documentation.
