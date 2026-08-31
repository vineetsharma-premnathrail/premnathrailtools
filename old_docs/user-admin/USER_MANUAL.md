# User Manual

A task-oriented guide to the Premnathrail Portal for day-to-day staff use. If a module described here doesn't appear in your left-hand sidebar, see [FAQ.md](./FAQ.md#why-cant-i-see-a-module-in-the-sidebar) — it's an access setting, not a bug.

For quick one-page references per module, see [MODULE_GUIDES.md](./MODULE_GUIDES.md). If something breaks (page won't load, server errors, etc.), see the existing troubleshooting guides: [../troubleshooting/TROUBLESHOOTING.md](../troubleshooting/TROUBLESHOOTING.md) and [../troubleshooting/FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md).

## Signing in

The portal uses **Microsoft sign-in only** — there is no portal-specific username/password.

1. Go to the portal's login page and click the sign-in button. You're redirected to Microsoft's login screen.
2. Sign in with your company Microsoft account (the same one you use for Outlook/Teams).
3. You're redirected back to the portal and land on your Dashboard.

**Inside Microsoft Teams:** if you open the portal as a Teams tab, it tries to sign you in silently using your existing Teams session — usually no extra click is needed. If silent sign-in fails, a "Sign-in required — tap below to continue" prompt appears; tap it to complete sign-in in a popup.

**Errors you might see on the login page:**
| Message | Meaning |
|---|---|
| "Your Microsoft account's email domain is not authorized for this portal." | Your account's email domain isn't on the portal's allowed list. Contact an administrator. |
| "Your account has been deactivated. Contact an administrator." | An admin has deactivated your account in Users & Roles. |

Your very first sign-in automatically creates your portal account using your Microsoft profile (name, job title, department, phone if set in Microsoft). An administrator must then assign you access to the modules you need — see [ADMIN_MANUAL.md](./ADMIN_MANUAL.md).

## Dashboard

After signing in you land on `/dashboard`, a landing page. Which modules show up in the sidebar (Service Module, R&D Tools, CRM Module, Purchase, Purchase Requisition) depends entirely on which apps have been assigned to you — see the FAQ if one is missing.

Look for the **Updates** button in the navbar for a "What's New" changelog of recent portal changes — see [RELEASE_NOTES.md](./RELEASE_NOTES.md) for the same history in document form.

There's also a **Feedback** nav item — use it to send issues or suggestions straight to the admin team.

---

## Service Module (ERP)

Nav path: **Service Module** in the sidebar → `/dashboard/erp`.

This is where projects, service requests, materials, and warranty/attachment tracking live.

- **View projects:** Service Module → Projects list. Click a project to see its detail page.
- **Create a project:** Projects list → "New Project" (only visible if you hold the `project_create` permission or are an admin) → fill in the form → Save.
- **Edit a project:** open the project → Edit (requires `project_edit`).
- **Delete a project:** requires `project_delete` — most staff will not see this option.
- **Service Requests:** Service Module → Service Requests. View requires `sr_view`; creating one requires `sr_create`, editing `sr_edit`, deleting `sr_delete`.
- **Materials on a Service Request:** open a Service Request → Materials tab. You can attach photos to materials here; those same photos are later visible from the linked Purchase Requisition.
- **Attachments/Warranty:** project and service-request detail pages have dedicated tabs for attachments and warranty information.

If an action button (Create/Edit/Delete) you expect to see is missing, it's almost certainly because you don't hold that specific ERP sub-permission — see [ADMIN_MANUAL.md](./ADMIN_MANUAL.md#erp-sub-permissions) for the full list, and ask an admin to grant it if you need it.

---

## CRM

Nav path: **CRM Module** in the sidebar → `/dashboard/crm`.

Manages contacts, organizations, leads, inquiries, deals, and tenders.

- **Organizations & Contacts:** browse/add/edit organizations from the Organizations list — you can now also add or edit an organization from *any* CRM page, not just the Organizations list.
- **Inquiries / Tenders:** each has an Activities tab for logging calls, meetings, and notes against it.
- **Logging an Activity:** open an Inquiry, Tender, or Organization → Activities tab → "New Activity". Pick the related Inquiry/Tender from a searchable dropdown (you no longer need to type an ID by hand). You can attach photos (camera or drag & drop) and record structured Minutes of Meeting (MOM) items and linked contacts.
- **Exporting Minutes of Meeting:** from an Inquiry's Activities tab, use "Export MOM" to download the meeting minutes as a Word (.docx) document or a PDF.
- **Viewing activity history:** an Organization's Activities tab shows every activity logged against its Inquiries/Tenders, even ones logged before that Inquiry was reassigned to the Organization.

---

## R&D Tools

Nav path: **R&D Tools** in the sidebar → `/dashboard/rnd`.

A suite of railway engineering calculators. Each has its own page under `/dashboard/rnd/`:

- Braking calculations — `/dashboard/rnd/braking`
- Hydraulic calculations — `/dashboard/rnd/hydraulic`
- Load distribution — `/dashboard/rnd/load-distribution`
- Qmax — `/dashboard/rnd/qmax`
- Spline calculations — `/dashboard/rnd/spline`
- Tractive effort — `/dashboard/rnd/tractive-effort`
- Vehicle performance — `/dashboard/rnd/vehicle-performance`
- Calculation history — `/dashboard/rnd/history` (past runs/results)

To do a calculation: open the relevant calculator page, fill in the input parameters, and submit — results (and, where supported, a PDF/report export) are generated on the page. Past calculations are retained under **History**.

---

## Purchase (Service-linked Purchase Requisitions)

Nav path: **Purchase** in the sidebar → `/dashboard/purchase`.

This module handles Purchase Requisitions that are **raised from a Service Request's materials list** — i.e. Service Module staff request materials, and Purchase manages the procurement pipeline: Requisitions → RFQs → Orders → GRN (goods receipt) → Invoices → Vendors.

- **Purchase Requisitions raised from Service:** Purchase → `/dashboard/purchase/[id]` opens a specific requisition. Each requisition's materials can carry a **remarks** field (e.g. vendor lead time notes) and you can view the same material photos that were uploaded from the Service Request's Materials tab.
- **Status:** a requisition's status can now be manually overridden by staff who need to correct it; materials are automatically marked "issued" once fully received.
- **RFQs, Orders, GRN, Invoices, Vendors:** each has its own section under Purchase for managing that stage of procurement.
- **PR Requests (Purchase team's view of the *other* PR module):** `/dashboard/purchase/pr-requests` — this is where the Purchase team reviews standalone Purchase Requisitions submitted through the separate Purchase Requisition module (see below), not the Service-linked ones.

---

## Purchase Requisition (standalone module)

Nav path: **Purchase Requisition** in the sidebar → `/dashboard/p2p`.

This is a **separate, newer module** from "Purchase" above — it lets any department raise a Purchase Requisition directly, without going through a Service Request.

- **Raise a new requisition:** `/dashboard/p2p/new` → fill in items/category/priority/required-by date and reason → submit.
- **View your requisitions:** the requisition list at `/dashboard/p2p` shows requests you've raised; click one to open its detail page (`/dashboard/p2p/[id]`) and track its approval/status.
- The Purchase team reviews these submissions from their own view under `/dashboard/purchase/pr-requests` (see above) — you don't need access to the Purchase module to raise or track your own requisition.

---

## Users & Roles (admin only)

Nav path: **Users & Roles** in the sidebar (only visible to admins) → `/dashboard/users`.

Covered fully in [ADMIN_MANUAL.md](./ADMIN_MANUAL.md) — regular staff will not see this nav item at all.
