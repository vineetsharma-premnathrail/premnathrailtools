# Module Quick Reference

One page per module: what it's for, how to get there, and the main things you'll do in it. See [USER_MANUAL.md](./USER_MANUAL.md) for step-by-step instructions and [ADMIN_MANUAL.md](./ADMIN_MANUAL.md) for access management.

---

## Service Module (ERP)

- **What it's for:** Projects, Service Requests, materials tracking, warranty/attachments.
- **Nav path:** Sidebar → "Service Module" → `/dashboard/erp` (visible only if `erp` is in your assigned apps, or you're an admin).
- **Main actions:** view/create/edit/delete Projects; view/create/edit/delete Service Requests; manage Materials (with photos) on a Service Request; track warranty and attachments.
- **Access note:** Create/Edit/Delete actions on Projects and Service Requests each require their own ERP sub-permission (`project_create`, `sr_edit`, etc.) — see [ADMIN_MANUAL.md](./ADMIN_MANUAL.md#erp-sub-permissions).

## CRM

- **What it's for:** Organizations, contacts, leads, inquiries, deals, tenders, and activity/MOM tracking.
- **Nav path:** Sidebar → "CRM Module" → `/dashboard/crm` (requires `crm` app access).
- **Main actions:** manage Organizations/Contacts; work Inquiries/Tenders/Deals; log Activities (with photos and structured MOM items) against an Inquiry, Tender, or Organization; export Minutes of Meeting as Word or PDF.

## R&D Tools

- **What it's for:** Railway engineering calculators.
- **Nav path:** Sidebar → "R&D Tools" → `/dashboard/rnd` (requires `rnd` app access).
- **Main actions / sub-pages:**
  | Calculator | Path |
  |---|---|
  | Braking | `/dashboard/rnd/braking` |
  | Hydraulic | `/dashboard/rnd/hydraulic` |
  | Load distribution | `/dashboard/rnd/load-distribution` |
  | Qmax | `/dashboard/rnd/qmax` |
  | Spline | `/dashboard/rnd/spline` |
  | Tractive effort | `/dashboard/rnd/tractive-effort` |
  | Vehicle performance | `/dashboard/rnd/vehicle-performance` |
  | History (past calculations) | `/dashboard/rnd/history` |

## Purchase (Service-linked Purchase Requisitions)

- **What it's for:** The procurement pipeline for materials requested through a Service Request — Purchase Requisitions → RFQs → Orders → GRN → Invoices → Vendors.
- **Nav path:** Sidebar → "Purchase" → `/dashboard/purchase` (requires `purchase` app access).
- **Main actions:** review/manage requisitions raised from Service Requests (`/dashboard/purchase/[id]`), RFQs (`/dashboard/purchase/rfqs`), Orders (`/dashboard/purchase/orders`), goods receipt (`/dashboard/purchase/grn`), Invoices (`/dashboard/purchase/invoices`), Vendors (`/dashboard/purchase/vendors`); manually override requisition status; view/attach material remarks and photos.
- **Also here:** `/dashboard/purchase/p2p-requests` — the Purchase team's view of submissions from the *separate* standalone Purchase Requisition module below.
- **Do not confuse with:** the standalone "Purchase Requisition" module — this one is specifically tied to Service Requests.

## Purchase Requisition (standalone module)

- **What it's for:** Letting any department raise a Purchase Requisition directly, independent of any Service Request.
- **Nav path:** Sidebar → "Purchase Requisition" → `/dashboard/p2p` (requires `p2p` app access).
- **Main actions:** raise a new requisition (`/dashboard/p2p/new`); view your submitted requisitions and their status (`/dashboard/p2p`, detail at `/dashboard/p2p/[id]`).
- **Reviewed by:** the Purchase team, from `/dashboard/purchase/p2p-requests` (which requires `purchase` app access, not `p2p`).

## Users & Roles (admin only)

- **What it's for:** Managing user accounts, activation status, module access, and ERP sub-permissions.
- **Nav path:** Sidebar → "Users & Roles" → `/dashboard/users` (visible only to admins; the page itself is also guarded server/client-side against non-admins).
- **Main actions:** activate/deactivate users; assign/remove module access per user; grant/revoke ERP sub-permissions; sync profile fields from Azure AD.
- **Full detail:** [ADMIN_MANUAL.md](./ADMIN_MANUAL.md).
